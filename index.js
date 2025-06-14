const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- ROTAS DE TÉCNICOS ---
app.get('/technicians', async (req, res) => {
  try {
    const technicians = await prisma.technician.findMany({ orderBy: { name: 'asc' } });
    res.status(200).json(technicians);
  } catch (error) { res.status(500).json({ error: 'Não foi possível listar os técnicos.' }); }
});
// ... (outras rotas de técnico como POST, PUT, DELETE continuam as mesmas) ...

// --- ROTAS DE ORDENS DE SERVIÇO ---
// ... (rotas POST, GET, etc. continuam as mesmas) ...

app.patch('/service-orders/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status, justification } = req.body;
    try {
        const dataToUpdate = { status };
        const currentOrder = await prisma.serviceOrder.findUnique({ where: { id: orderId } });

        if (!currentOrder) return res.status(404).json({ error: 'OS não encontrada.' });

        if (status === 'EXECUTANDO') {
            dataToUpdate.executionStartTime = new Date();
        } else if (currentOrder.status === 'EXECUTANDO' && (status === 'FINALIZADA' || status === 'REAGENDADA')) {
            if (currentOrder.executionStartTime) {
                const startTime = new Date(currentOrder.executionStartTime);
                const endTime = new Date();
                const durationInMinutes = Math.round((endTime - startTime) / 60000);
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
        const updatedOrder = await prisma.serviceOrder.update({
            where: { id: orderId },
            data: { 
                technicianId: newTechnicianId,
                position: 999 // Joga para o final da lista do novo técnico
            }
        });
        res.status(200).json(updatedOrder);
    } catch (error) { res.status(500).json({ error: "Não foi possível transferir a OS." }); }
});
// ... (outras rotas de OS como DELETE, reorder continuam as mesmas) ...

// --- ROTA DE AUTENTICAÇÃO ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Login especial do Admin
        if (email === 'admin@suaempresa.com' && password === 'admin123') {
            return res.status(200).json({ name: 'Admin', role: 'ADMIN' });
        }

        const technician = await prisma.technician.findUnique({ where: { email } });
        if (technician && technician.password === password) {
            const { password, ...technicianData } = technician;
            res.status(200).json({ ...technicianData, role: 'TECHNICIAN' }); // Adiciona o papel
        } else {
            res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (error) { res.status(500).json({ error: 'Erro interno do servidor' }); }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
