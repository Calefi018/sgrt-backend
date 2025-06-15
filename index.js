const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// ROTA DE "SAÚDE" DA API
app.get('/', (req, res) => {
    res.send('API do Sistema de Gestão de Rotas está no ar e funcionando!');
});

// --- ROTA DE AUTENTICAÇÃO ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (email === 'admin@suaempresa.com' && password === 'admin123') {
            return res.status(200).json({ name: 'Admin', role: 'ADMIN' });
        }
        const technician = await prisma.technician.findUnique({ where: { email } });
        if (technician && technician.password === password) {
            const { password, ...technicianData } = technician;
            res.status(200).json({ ...technicianData, role: 'TECHNICIAN' });
        } else {
            res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (error) { res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// --- ROTAS DE TÉCNICOS (CRUD) ---
app.get('/technicians', async (req, res) => {
  try {
    const technicians = await prisma.technician.findMany({ orderBy: { name: 'asc' } });
    res.status(200).json(technicians);
  } catch (error) { res.status(500).json({ error: 'Não foi possível listar os técnicos.' }); }
});

app.post('/technicians', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const newTechnician = await prisma.technician.create({ data: { name, email, password } });
    res.status(201).json(newTechnician);
  } catch (error) { res.status(500).json({ error: 'Não foi possível criar o técnico.' }); }
});

app.put('/technicians/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;
  try {
    const updatedTechnician = await prisma.technician.update({ where: { id: id }, data: { name, email } });
    res.status(200).json(updatedTechnician);
  } catch (error) { res.status(500).json({ error: 'Não foi possível atualizar o técnico.' }); }
});

app.delete('/technicians/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // A opção onDelete: Cascade no schema.prisma agora lida com a exclusão em cascata
    await prisma.technician.delete({ where: { id: id } });
    res.status(204).send();
  } catch (error) { res.status(500).json({ error: 'Não foi possível deletar o técnico.' }); }
});

// --- ROTAS DE ORDENS DE SERVIÇO (OS) ---
app.post('/service-orders', async (req, res) => {
    try {
        const newOrder = await prisma.serviceOrder.create({ data: req.body });
        // Cria o primeiro registro no histórico
        await prisma.statusHistory.create({
            data: { serviceOrderId: newOrder.id, status: 'PENDENTE', notes: 'OS Criada' }
        });
        res.status(201).json(newOrder);
    } catch (error) { res.status(500).json({ error: "Não foi possível criar a Ordem de Serviço." }); }
});

app.get('/service-orders', async (req, res) => {
    try {
        const orders = await prisma.serviceOrder.findMany({
            include: { technician: true, statusHistory: { orderBy: { timestamp: 'asc' } } },
            orderBy: [{ technicianId: 'asc' }, { position: 'asc' }]
        });
        res.status(200).json(orders);
    } catch (error) { res.status(500).json({ error: "Não foi possível buscar as Ordens de Serviço." }); }
});

app.get('/my-route', async (req, res) => {
    const { technicianId } = req.query;
    try {
        const orders = await prisma.serviceOrder.findMany({
            where: { technicianId: technicianId },
            orderBy: { position: 'asc' }
        });
        res.status(200).json(orders);
    } catch (error) { res.status(500).json({ error: "Não foi possível buscar a rota." }); }
});

app.patch('/service-orders/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status, justification, location } = req.body;
    try {
        const currentOrder = await prisma.serviceOrder.findUnique({ where: { id: orderId } });
        if (!currentOrder) return res.status(404).json({ error: 'OS não encontrada.' });
        
        const dataToUpdate = { status };

        if (location) {
            if (status === 'A_CAMINHO') {
                dataToUpdate.startTravelLatitude = location.latitude;
                dataToUpdate.startTravelLongitude = location.longitude;
            } else if (status === 'EXECUTANDO') {
                dataToUpdate.executionLatitude = location.latitude;
                dataToUpdate.executionLongitude = location.longitude;
            }
        }
        
        if (status === 'EXECUTANDO') {
            dataToUpdate.executionStartTime = new Date();
        } else if (currentOrder.status === 'EXECUTANDO' && (status === 'FINALIZADA' || status === 'REAGENDADA')) {
            if (currentOrder.executionStartTime) {
                const durationInMinutes = Math.round((new Date() - new Date(currentOrder.executionStartTime)) / 60000);
                dataToUpdate.executionDuration = durationInMinutes;
            }
        }
        
        const notesForHistory = status === 'REAGENDADA' ? justification : null;
        if (notesForHistory) dataToUpdate.notes = `Reagendado: ${notesForHistory}`;

        const [updatedOrder] = await prisma.$transaction([
            prisma.serviceOrder.update({ where: { id: orderId }, data: dataToUpdate }),
            prisma.statusHistory.create({
                data: { serviceOrderId: orderId, status: status, notes: notesForHistory }
            })
        ]);

        res.status(200).json(updatedOrder);
    } catch (error) { 
        console.error("Erro ao atualizar status:", error);
        res.status(500).json({ error: "Não foi possível atualizar o status." }); 
    }
});

app.patch('/service-orders/:orderId/transfer', async (req, res) => {
    const { orderId } = req.params;
    const { newTechnicianId } = req.body;
    if (!newTechnicianId) return res.status(400).json({ error: "O ID do novo técnico é obrigatório." });
    try {
        const maxPositionResult = await prisma.serviceOrder.aggregate({ _max: { position: true }, where: { technicianId: newTechnicianId } });
        const newPosition = (maxPositionResult._max.position || -1) + 1;
        
        const [updatedOrder] = await prisma.$transaction([
            prisma.serviceOrder.update({ where: { id: orderId }, data: { technicianId: newTechnicianId, position: newPosition, status: 'PENDENTE' } }),
            prisma.statusHistory.create({ data: { serviceOrderId: orderId, status: 'TRANSFERIDA' } })
        ]);
        res.status(200).json(updatedOrder);
    } catch (error) { res.status(500).json({ error: "Não foi possível transferir a OS." }); }
});

app.post('/service-orders/reorder', async (req, res) => {
    const { orderedIds } = req.body;
    try {
        const updatePromises = orderedIds.map((id, index) =>
            prisma.serviceOrder.update({ where: { id: id }, data: { position: index } })
        );
        await prisma.$transaction(updatePromises);
        res.status(200).json({ message: 'Ordem atualizada com sucesso.' });
    } catch (error) { res.status(500).json({ error: 'Erro ao reordenar as OS.' }); }
});

app.get('/service-orders/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const order = await prisma.serviceOrder.findUnique({ where: { id: id } });
        if (!order) return res.status(404).json({ error: 'Ordem de Serviço não encontrada.' });
        res.status(200).json(order);
    } catch (error) { res.status(500).json({ error: 'Não foi possível buscar a Ordem de Serviço.' }); }
});

app.put('/service-orders/:id', async (req, res) => {
    const { id } = req.params;
    const { clientId, clientName, address, problemDescription, priority, period, notes } = req.body;
    try {
        const updatedOrder = await prisma.serviceOrder.update({
            where: { id: id },
            data: { clientId: parseInt(clientId), clientName, address, problemDescription, priority, period, notes },
        });
        res.status(200).json(updatedOrder);
    } catch (error) { res.status(500).json({ error: 'Não foi possível atualizar a Ordem de Serviço.' }); }
});

app.delete('/service-orders/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.serviceOrder.delete({ where: { id: id } });
        res.status(204).send();
    } catch (error) { res.status(500).json({ error: 'Não foi possível deletar a OS.' }); }
});

// --- ROTA NOVA PARA EXCLUSÃO EM MASSA ---
app.delete('/service-orders/all', async (req, res) => {
    try {
        await prisma.serviceOrder.deleteMany({});
        res.status(204).send(); // Sucesso, sem conteúdo para retornar
    } catch (error) {
        console.error("Erro ao deletar todas as OS:", error);
        res.status(500).json({ error: 'Não foi possível deletar todas as Ordens de Serviço.' });
    }
});


// --- ROTA DE RELATÓRIOS ---
app.get('/reports/service-orders', async (req, res) => {
    const { startDate, endDate, technicianId } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'As datas de início e fim são obrigatórias.' });
    }
    try {
        const whereClause = {
            createdAt: {
                gte: new Date(startDate),
                lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
            }
        };
        if (technicianId) {
            whereClause.technicianId = technicianId;
        }
        const orders = await prisma.serviceOrder.findMany({
            where: whereClause,
            include: {
                technician: true,
                statusHistory: { orderBy: { timestamp: 'asc' } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json(orders);
    } catch (error) {
        console.error("Erro ao gerar relatório:", error);
        res.status(500).json({ error: "Não foi possível gerar o relatório." });
    }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
