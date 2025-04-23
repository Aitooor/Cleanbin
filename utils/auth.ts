import fs from 'fs/promises';
import path from 'path';
import { NextApiRequest, NextApiResponse } from 'next';

const ADMIN_FILE_PATH = './data/admins.json';

async function loadAdmins() {
    try {
        const data = await fs.readFile(ADMIN_FILE_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return []; // Return empty array if file doesn't exist
        }
        throw error;
    }
}

interface Admin {
    email: string;
    password: string;
}

async function saveAdmins(admins: Admin[]): Promise<void> {
    await fs.mkdir(path.dirname(ADMIN_FILE_PATH), { recursive: true });
    await fs.writeFile(ADMIN_FILE_PATH, JSON.stringify(admins, null, 2));
}

export const authenticateAdmin = async (req: NextApiRequest, res: NextApiResponse) => {
    const { email, password } = req.body;
    const admins = await loadAdmins();

    const admin: Admin | undefined = admins.find((admin: Admin) => admin.email === email && admin.password === password);
    if (admin) {
        return res.status(200).json({ message: 'Authentication successful' });
    } else {
        return res.status(401).json({ message: 'Invalid credentials' });
    }
};

export async function getAdmins() {
    try {
        const data = await fs.readFile(ADMIN_FILE_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return []; // Return empty array if file doesn't exist
        }
        throw error;
    }
}

export const createAdmin = async (email: string, password: string) => {
    const admins = await loadAdmins();
    if (admins.find((admin: Admin) => admin.email === email)) {
        throw new Error('Admin with this email already exists');
    }
    admins.push({ email, password });
    await saveAdmins(admins);
};

export const updateAdmin = async (email: string, newPassword: string) => {
    const admins = await loadAdmins();
    const admin: Admin | undefined = admins.find((admin: Admin) => admin.email === email);
    if (!admin) {
        throw new Error('Admin not found');
    }
    admin.password = newPassword;
    await saveAdmins(admins);
};

export const deleteAdmin = async (email: string) => {
    const admins = await loadAdmins();
    const updatedAdmins: Admin[] = admins.filter((admin: Admin) => admin.email !== email);
    await saveAdmins(updatedAdmins);
};