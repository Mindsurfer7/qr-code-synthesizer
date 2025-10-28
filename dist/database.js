"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.database = void 0;
const sqlite3_1 = __importDefault(require("sqlite3"));
const path = __importStar(require("path"));
class Database {
    constructor() {
        this.db = null;
        this.initialized = false;
    }
    // Инициализация базы данных
    async initialize() {
        return new Promise((resolve, reject) => {
            const dbPath = path.join(__dirname, '..', 'data', 'bot.db');
            // Создаем директорию data если её нет
            const fs = require('fs');
            const dataDir = path.dirname(dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            this.db = new sqlite3_1.default.Database(dbPath, (err) => {
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
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db)
                throw new Error('Database not initialized');
            this.db.run(sql, params, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db)
                throw new Error('Database not initialized');
            this.db.get(sql, params, (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row);
            });
        });
    }
    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db)
                throw new Error('Database not initialized');
            this.db.all(sql, params, (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
    }
    // Создание таблиц
    async createTables() {
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
    ensureInitialized() {
        if (!this.db || !this.initialized) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
    }
    // Получить пользователя или создать нового
    async getOrCreateUser(userId, username, firstName, lastName) {
        this.ensureInitialized();
        // Пытаемся найти пользователя
        let user = await this.get('SELECT * FROM users WHERE tgUserId = ?', [userId]);
        if (!user) {
            // Создаем нового пользователя
            await this.run('INSERT INTO users (tgUserId, username, firstName, lastName, freeStandardAvailable, premiumHighAvailable, premiumUltraAvailable, totalSpentStars) VALUES (?, ?, ?, ?, 5, 0, 0, 0)', [userId, username, firstName, lastName]);
            console.log(`✅ Created new user: ${userId}`);
            // Получаем созданного пользователя
            user = await this.get('SELECT * FROM users WHERE tgUserId = ?', [userId]);
        }
        else {
            // Обновляем информацию о пользователе (если изменился username)
            await this.run('UPDATE users SET username = ?, firstName = ?, lastName = ? WHERE tgUserId = ?', [username, firstName, lastName, userId]);
        }
        return user;
    }
    // Получить пользователя
    async getUser(userId) {
        this.ensureInitialized();
        return await this.get('SELECT * FROM users WHERE tgUserId = ?', [userId]);
    }
    // Проверить доступность бесплатного стандартного QR
    async useFreeStandardQR(userId) {
        this.ensureInitialized();
        const user = await this.getUser(userId);
        if (!user || user.freeStandardAvailable <= 0) {
            return false;
        }
        await this.run('UPDATE users SET freeStandardAvailable = freeStandardAvailable - 1 WHERE tgUserId = ? AND freeStandardAvailable > 0', [userId]);
        return true;
    }
    // Проверить доступность премиум High
    async usePremiumHighQR(userId) {
        this.ensureInitialized();
        const user = await this.getUser(userId);
        if (!user || user.premiumHighAvailable <= 0) {
            return false;
        }
        await this.run('UPDATE users SET premiumHighAvailable = premiumHighAvailable - 1 WHERE tgUserId = ? AND premiumHighAvailable > 0', [userId]);
        return true;
    }
    // Проверить доступность премиум Ultra
    async usePremiumUltraQR(userId) {
        this.ensureInitialized();
        const user = await this.getUser(userId);
        if (!user || user.premiumUltraAvailable <= 0) {
            return false;
        }
        await this.run('UPDATE users SET premiumUltraAvailable = premiumUltraAvailable - 1 WHERE tgUserId = ? AND premiumUltraAvailable > 0', [userId]);
        return true;
    }
    // Добавить премиум QR после оплаты
    async addPremiumQR(userId, productType, quantity) {
        this.ensureInitialized();
        if (productType === 'high') {
            await this.run('UPDATE users SET premiumHighAvailable = premiumHighAvailable + ? WHERE tgUserId = ?', [quantity, userId]);
        }
        else {
            await this.run('UPDATE users SET premiumUltraAvailable = premiumUltraAvailable + ? WHERE tgUserId = ?', [quantity, userId]);
        }
    }
    // Сохранить платеж
    async savePayment(payment) {
        this.ensureInitialized();
        try {
            await this.run(`INSERT INTO payments (tgUserId, telegramPaymentChargeId, payload, amount, currency, status, timestamp, productType, quantity)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                payment.tgUserId,
                payment.telegramPaymentChargeId,
                payment.payload,
                payment.amount,
                payment.currency,
                payment.status,
                payment.timestamp.toISOString(),
                payment.productType,
                payment.quantity
            ]);
            // Обновляем totalSpentStars
            await this.run('UPDATE users SET totalSpentStars = totalSpentStars + ? WHERE tgUserId = ?', [payment.amount, payment.tgUserId]);
            console.log(`✅ Payment saved: ${payment.telegramPaymentChargeId}`);
        }
        catch (error) {
            console.error('Error saving payment:', error);
            throw error;
        }
    }
    // Получить историю платежей пользователя
    async getUserPayments(userId) {
        this.ensureInitialized();
        return await this.all('SELECT * FROM payments WHERE tgUserId = ? ORDER BY timestamp DESC LIMIT 10', [userId]);
    }
    // Закрытие соединения
    close() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve();
                return;
            }
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                    reject(err);
                }
                else {
                    console.log('✅ Database connection closed');
                    resolve();
                }
            });
        });
    }
}
exports.database = new Database();
