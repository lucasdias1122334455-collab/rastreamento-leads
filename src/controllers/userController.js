const bcrypt = require('bcryptjs');
const prisma = require('../config/database');

// Lista todos os usuários
async function list(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (err) { next(err); }
}

// Cria novo usuário
async function create(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email já cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hash, role: role || 'agent' },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
}

// Atualiza usuário
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const { name, email, password, role, active } = req.body;

    const data = {};
    if (name) data.name = name;
    if (email) data.email = email;
    if (role) data.role = role;
    if (typeof active === 'boolean') data.active = active;
    if (password) data.password = await bcrypt.hash(password, 10);

    // Impede admin de desativar a si mesmo
    if (req.user.id === id && active === false) {
      return res.status(400).json({ error: 'Você não pode desativar sua própria conta' });
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.json(user);
  } catch (err) { next(err); }
}

// Remove usuário
async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (req.user.id === id) {
      return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
    }
    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove };
