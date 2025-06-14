// index.js (versão atualizada)
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client'); // Importe o Prisma

const prisma = new PrismaClient(); // Crie uma instância do cliente
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- ROTAS DE TÉCNICOS ---

// Rota para CRIAR um novo técnico
app.post('/technicians', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    // ATENÇÃO: Em um projeto real, a senha NUNCA deve ser salva como texto puro.
    // Usaríamos bibliotecas como 'bcrypt' para criar um hash da senha.
    // Por simplicidade, vamos pular essa etapa por enquanto.
    const newTechnician = await prisma.technician.create({
      data: {
        name,
        email,
        password, // Lembre-se do aviso sobre a senha!
      },
    });
    res.status(201).json(newTechnician);
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível criar o técnico.' });
  }
});

// Rota para LISTAR todos os técnicos
app.get('/technicians', async (req, res) => {
  try {
    const technicians = await prisma.technician.findMany();
    res.status(200).json(technicians);
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível listar os técnicos.' });
  }
});

// --- FIM DAS ROTAS DE TÉCNICOS ---


// --- ROTAS DE ORDENS DE SERVIÇO (Exemplos) ---

// Rota para CRIAR uma nova OS
app.post('/service-orders', async (req, res) => {
    try {
        const { orderNumber, clientName, address, problemDescription, priority, period, notes, technicianId } = req.body;
        const newOrder = await prisma.serviceOrder.create({
            data: {
                orderNumber: parseInt(orderNumber), // Garante que seja um número
                clientName,
                address,
                problemDescription,
                priority,
                period,
                notes,
                technicianId
            }
        });
        res.status(201).json(newOrder);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Não foi possível criar a Ordem de Serviço." });
    }
});

// Rota para PEGAR TODAS as OS (para o admin)
app.get('/service-orders', async (req, res) => {
    try {
        const orders = await prisma.serviceOrder.findMany({
            include: { technician: true } // Inclui os dados do técnico em cada OS
        });
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ error: "Não foi possível buscar as Ordens de Serviço." });
    }
});

// Rota para o técnico PEGAR SUA PRÓPRIA ROTA
app.get('/my-route/:technicianId', async (req, res) => {
    try {
        const { technicianId } = req.params;
        const orders = await prisma.serviceOrder.findMany({
            where: {
                technicianId: technicianId,
                // Poderíamos adicionar filtros por data aqui no futuro
            },
            orderBy: {
                createdAt: 'asc' // Ordena pela mais antiga
            }
        });
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ error: "Não foi possível buscar a rota." });
    }
});

// Rota para ATUALIZAR O STATUS de uma OS
app.patch('/service-orders/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body; // O novo status virá no corpo da requisição

        // Validação simples do status
        const validStatus = ["PENDENTE", "A_CAMINHO", "EXECUTANDO", "FINALIZADA", "REAGENDADA"];
        if (!validStatus.includes(status)) {
            return res.status(400).json({ error: "Status inválido." });
        }

        const updatedOrder = await prisma.serviceOrder.update({
            where: { id: orderId },
            data: { status: status }
        });
        res.status(200).json(updatedOrder);
    } catch (error) {
        res.status(500).json({ error: "Não foi possível atualizar o status." });
    }
});


// --- FIM DAS ROTAS DE OS ---

// index.js (backend) - Adicionar esta rota

// --- ROTA DE AUTENTICAÇÃO ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const technician = await prisma.technician.findUnique({
            where: { email: email }
        });

        // ATENÇÃO: Verificação de senha em texto puro. 
        // Em um projeto real, usaríamos bcrypt.compare()
        if (technician && technician.password === password) {
            // Não envie a senha de volta para o cliente!
            const { password, ...technicianData } = technician;
            res.status(200).json(technicianData);
        } else {
            res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
