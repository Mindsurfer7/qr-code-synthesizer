import sqlite3 from 'sqlite3';
import * as path from 'path';

// Типы для базы данных
export interface User {
    tgUserId: number;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    createdAt: Date;
    freeStandardAvailable: number;
    premiumHighAvailable: number;
    premiumUltraAvailable: number;
    totalSpentStars: number;
}

export interface Payment {
    id?: number;
    tgUserId: number;
    telegramPaymentChargeId: string;
    payload: string;
    amount: number;
    currency: string;
    status: string;
    timestamp: Date;
    productType: string;
    quantity: number;
}

class Database {
    private db: sqlite3.Database | null = null;
    private initialized: boolean = false;

    // Инициализация базы данных
    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            const dbPath = path.join(__dirname, '..', 'data', 'bot.db');
            
            // Создаем директорию data если её нет
            const fs = require('fs');
            const dataDir = path.dirname(dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('Database connection error:', err);
                    reject(err);
                    return;
                }
                console.log('✅ Connected to SQLite database');
            });

            // Включаем foreign keys
            this.db.run('PRAGMA foreign_keys = ON', (err) => {
                if (err) {
                    console.error('Error enabling foreign keys:', err);
                }
            });

            // Создаем таблицы
            this.createTables()
                .then(() => {
                    this.initialized = true;
                    resolve();
                })
                .catch(reject);
        });
    }

    // Вспомогательные методы для работы с БД
    private async run(sql: string, params: any[] = []): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error('Database not initialized');
            this.db.run(sql, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    private async get(sql: string, params: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error('Database not initialized');
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    private async all(sql: string, params: any[] = []): Promise<any[]> {
        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error('Database not initialized');
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Создание таблиц
    private async createTables(): Promise<void> {
        // Таблица пользователей
        await this.run(`
            CREATE TABLE IF NOT EXISTS users (
                tgUserId INTEGER PRIMARY KEY,
                username TEXT,
                firstName TEXT,
                lastName TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                freeStandardAvailable INTEGER DEFAULT 5,
                premiumHighAvailable INTEGER DEFAULT 0,
                premiumUltraAvailable INTEGER DEFAULT 0,
                totalSpentStars INTEGER DEFAULT 0
            )
        `);

        // Таблица платежей
        await this.run(`
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tgUserId INTEGER NOT NULL,
                telegramPaymentChargeId TEXT UNIQUE NOT NULL,
                payload TEXT NOT NULL,
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'completed',
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                productType TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                FOREIGN KEY (tgUserId) REFERENCES users(tgUserId)
            )
        `);

        console.log('✅ Database tables created successfully');
    }

    // Проверка инициализации
    private ensureInitialized(): void {
        if (!this.db || !this.initialized) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
    }

    // Получить пользователя или создать нового
    async getOrCreateUser(userId: number, username: string | null, firstName: string | null, lastName: string | null): Promise<User> {
        this.ensureInitialized();

        // Пытаемся найти пользователя
        let user: User | undefined = await this.get('SELECT * FROM users WHERE tgUserId = ?', [userId]) as User | undefined;

        if (!user) {
            // Создаем нового пользователя
            await this.run(
                'INSERT INTO users (tgUserId, username, firstName, lastName, freeStandardAvailable, premiumHighAvailable, premiumUltraAvailable, totalSpentStars) VALUES (?, ?, ?, ?, 5, 0, 0, 0)',
                [userId, username, firstName, lastName]
            );
            
            // Получаем созданного пользователя
            user = await this.get('SELECT * FROM users WHERE tgUserId = ?', [userId]) as User;
        } else {
            // Обновляем информацию о пользователе (если изменился username)
            await this.run(
                'UPDATE users SET username = ?, firstName = ?, lastName = ? WHERE tgUserId = ?',
                [username, firstName, lastName, userId]
            );
        }

        return user!;
    }

    // Получить пользователя
    async getUser(userId: number): Promise<User | null> {
        this.ensureInitialized();
        return await this.get('SELECT * FROM users WHERE tgUserId = ?', [userId]) as User | null;
    }

    // Проверить доступность бесплатного стандартного QR
    async useFreeStandardQR(userId: number): Promise<boolean> {
        this.ensureInitialized();

        const user = await this.getUser(userId);
        if (!user || user.freeStandardAvailable <= 0) {
            return false;
        }

        await this.run(
            'UPDATE users SET freeStandardAvailable = freeStandardAvailable - 1 WHERE tgUserId = ? AND freeStandardAvailable > 0',
            [userId]
        );

        return true;
    }

    // Проверить доступность премиум High
    async usePremiumHighQR(userId: number): Promise<boolean> {
        this.ensureInitialized();

        const user = await this.getUser(userId);
        if (!user || user.premiumHighAvailable <= 0) {
            return false;
        }

        await this.run(
            'UPDATE users SET premiumHighAvailable = premiumHighAvailable - 1 WHERE tgUserId = ? AND premiumHighAvailable > 0',
            [userId]
        );

        return true;
    }

    // Проверить доступность премиум Ultra
    async usePremiumUltraQR(userId: number): Promise<boolean> {
        this.ensureInitialized();

        const user = await this.getUser(userId);
        if (!user || user.premiumUltraAvailable <= 0) {
            return false;
        }

        await this.run(
            'UPDATE users SET premiumUltraAvailable = premiumUltraAvailable - 1 WHERE tgUserId = ? AND premiumUltraAvailable > 0',
            [userId]
        );

        return true;
    }

    // Добавить премиум QR после оплаты
    async addPremiumQR(userId: number, productType: 'high' | 'ultra', quantity: number): Promise<void> {
        this.ensureInitialized();

        if (productType === 'high') {
            await this.run(
                'UPDATE users SET premiumHighAvailable = premiumHighAvailable + ? WHERE tgUserId = ?',
                [quantity, userId]
            );
        } else {
            await this.run(
                'UPDATE users SET premiumUltraAvailable = premiumUltraAvailable + ? WHERE tgUserId = ?',
                [quantity, userId]
            );
        }
    }

    // Сохранить платеж
    async savePayment(payment: Omit<Payment, 'id'>): Promise<void> {
        this.ensureInitialized();

        try {
            await this.run(
                `INSERT INTO payments (tgUserId, telegramPaymentChargeId, payload, amount, currency, status, timestamp, productType, quantity)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    payment.tgUserId,
                    payment.telegramPaymentChargeId,
                    payment.payload,
                    payment.amount,
                    payment.currency,
                    payment.status,
                    payment.timestamp.toISOString(),
                    payment.productType,
                    payment.quantity
                ]
            );

            // Обновляем totalSpentStars
            await this.run(
                'UPDATE users SET totalSpentStars = totalSpentStars + ? WHERE tgUserId = ?',
                [payment.amount, payment.tgUserId]
            );

        } catch (error) {
            console.error('Error saving payment:', error);
            throw error;
        }
    }

    // Получить историю платежей пользователя
    async getUserPayments(userId: number): Promise<Payment[]> {
        this.ensureInitialized();
        return await this.all('SELECT * FROM payments WHERE tgUserId = ? ORDER BY timestamp DESC LIMIT 10', [userId]) as Payment[];
    }

    // Закрытие соединения
    close(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve();
                return;
            }

            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                    reject(err);
                } else {
                    console.log('✅ Database connection closed');
                    resolve();
                }
            });
        });
    }
}

export const database = new Database();

