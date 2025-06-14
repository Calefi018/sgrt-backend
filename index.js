const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- ROTAS DE AUTENTICAÇÃO ---
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

// --- ROTAS DE TÉCNICOS ---
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
    await prisma.serviceOrder.deleteMany({ where: { technicianId: id } });
    await prisma.technician.delete({ where: { id: id } });
    res.status(204).send();
  } catch (error) { res.status(500).json({ error: 'Não foi possível deletar o técnico.' }); }
});

// --- ROTAS DE ORDENS DE SERVIÇO ---
app.post('/service-orders', async (req, res) => {
    try {
        const newOrder = await prisma.serviceOrder.create({ data: req.body });
        res.status(201).json(newOrder);
    } catch (error) { res.status(500).json({ error: "Não foi possível criar a Ordem de Serviço." }); }
});

app.get('/service-orders', async (req, res) => {
    try {
        const orders = await prisma.serviceOrder.findMany({
            include: { technician: true },
            orderBy: [{ technicianId: 'asc' }, { position: 'asc' }]
        });
        res.status(200).json(orders);
    } catch (error) { res.status(500).json({ error: "Não foi possível buscar as Ordens de Serviço." }); }
});

app.get('/my-route', async (req, res) => { // Alterado para não precisar de ID na URL
    const { technicianId } = req.query; // Pega o ID dos parâmetros da query
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
    const { status, justification } = req.body;
    try {
        const currentOrder = await prisma.serviceOrder.findUnique({ where: { id: orderId } });
        if (!currentOrder) return res.status(404).json({ error: 'OS não encontrada.' });
        
        const dataToUpdate = { status };
        if (status === 'EXECUTANDO') {
            dataToUpdate.executionStartTime = new Date();
        } else if (currentOrder.status === 'EXECUTANDO' && (status === 'FINALIZADA' || status === 'REAGENDADA')) {
            if (currentOrder.executionStartTime) {
                const durationInMinutes = Math.round((new Date() - new Date(currentOrder.executionStartTime)) / 60000);
                dataToUpdate.executionDuration = durationInMinutes;
            }
        }
        if (status === 'REAGENDADA' && justification) {
            dataToUpdate.notes = `Reagendado: ${justification}`;
        }

        const updatedOrder = await prisma.serviceOrder.update({ where: { id: orderId }, data: dataToUpdate });
        res.status(200).json(updatedOrder);
    } catch (error) { res.status(500).json({ error: "Não foi possível atualizar o status." }); }
});

app.patch('/service-orders/:orderId/transfer', async (req, res) => {
    const { orderId } = req.params;
    const { newTechnicianId } = req.body;
    try {
        const maxPosition = await prisma.serviceOrder.aggregate({
            _max: { position: true },
            where: { technicianId: newTechnicianId }
        });
        const updatedOrder = await prisma.serviceOrder.update({
            where: { id: orderId },
            data: { technicianId: newTechnicianId, position: (maxPosition._max.position || 0) + 1 }
        });
        res.status(200).json(updatedOrder);
    } catch (error) { res.status(500).json({ error: "Não foi possível transferir a OS." }); }
});

app.delete('/service-orders/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.serviceOrder.delete({ where: { id: id } });
        res.status(204).send();
    } catch (error) { res.status(500).json({ error: 'Não foi possível deletar a OS.' }); }
});

app.post('/service-orders/reorder', async (req, res) => {
    const { orderedIds } = req.body;
    try {
        const updatePromises = orderedIds.map((id, index) =>
            prisma.serviceOrder.update({ where: { id: id }, data: { position: index } })
        );
        await prisma.$transaction(updatePromises);
        res.status(200).json({ message: 'Ordem atualizada.' });
    } catch (error) { res.status(500).json({ error: 'Erro ao reordenar as OS.' }); }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
