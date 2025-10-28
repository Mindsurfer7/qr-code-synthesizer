import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import sharp from 'sharp';
import svg2png from 'svg2png';
import axios from 'axios';
import { database } from './database';

// Загрузка переменных окружения
config();

// Проверка наличия токена
if (!process.env.BOT_TOKEN) {
    console.error('Ошибка: BOT_TOKEN не найден в переменных окружения!');
    console.error('Пожалуйста, создайте файл .env и добавьте в него BOT_TOKEN=your_token_here');
    process.exit(1);
}

// Интерфейс для настроек рендеринга
interface RenderSettings {
    roundedRadius: number;    // Скругление углов модулей (0 = квадраты)
    moduleStyle: 'square' | 'diamond' | 'circle'; // Стиль модулей
}

// Интерфейс для хранения состояния пользователя
interface UserState {
    awaitingChoice: boolean;  // ожидаем выбор между "С логотипом" или "Без логотипа"
    awaitingLogo: boolean;   // ожидаем логотип
    awaitingUrl: boolean;     // ожидаем ссылку
    awaitingQuality: boolean; // ожидаем выбор качества
    awaitingRenderSettings: boolean; // ожидаем настройки рендеринга
    logoPath?: string;
    quality?: 'standard' | 'high' | 'ultra';
    renderSettings?: RenderSettings; // Настройки рендеринга
}

// Хранилище состояний пользователей
const userStates = new Map<number, UserState>();

// Предустановленные настройки рендеринга
const renderSettingsPresets: Record<string, RenderSettings> = {
    'Квадраты': { roundedRadius: 0, moduleStyle: 'square' },
    'Скругленные': { roundedRadius: 8, moduleStyle: 'square' },
    'Круглые': { roundedRadius: 0, moduleStyle: 'circle' }
};

// Функция для очистки папки temp
function cleanupTempFolder() {
    const tempDir = path.join(__dirname, 'temp');
    
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(`Ошибка при удалении файла ${filePath}:`, error);
            }
        }
    }
}

// Функция для обработки ссылки
function processUrl(text: string): string {
    text = text.trim();
    if (!text.match(/^https?:\/\//i)) {
        text = 'https://' + text;
    }
    return text;
}

// Функция для скачивания файла
async function downloadFile(url: string, filePath: string): Promise<void> {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Функция для создания QR-кода с логотипом
async function generateQRWithLogo(
    url: string, 
    logoPath?: string, 
    quality: 'standard' | 'high' | 'ultra' = 'high',
    renderSettings?: RenderSettings
): Promise<string> {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }
    const unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const qrCodePath = path.join(tempDir, `${unique}_qr.png`);
    const qrFinalPath = path.join(tempDir, `${unique}_qr_final.png`);

    // Настройки качества
    const qualitySettings = {
        standard: { qrSize: 400, margin: 20, logoSize: 100, padding: 25 },
        high: { qrSize: 800, margin: 40, logoSize: 200, padding: 50 },
        ultra: { qrSize: 1600, margin: 80, logoSize: 400, padding: 100 }
    };

    const settings = qualitySettings[quality];
    const { qrSize, margin, logoSize, padding } = settings;
    const whiteCircleRadius = (logoSize + padding * 2) / 2 * 0.85; // Уменьшено на 15%
    
    // Применяем настройки рендеринга или используем значения по умолчанию
    const roundedRadius = renderSettings?.roundedRadius ?? 0;
    const moduleStyle = renderSettings?.moduleStyle ?? 'square';

    // Получаем матрицу QR-кода через низкоуровневый API
    const qr = qrcode.create(url, {
        errorCorrectionLevel: 'H'
    });

    const moduleCount = qr.modules.size;
    
    // Размер QR-кода без margin (внутренняя область)
    const qrContentSize = qrSize - (margin * 2);
    
    // Создаем SVG с модифицированной матрицей (без паттернов в центре)
    let svgString = `<svg width="${qrSize}" height="${qrSize}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" image-rendering="crisp-edges">`;
    
    // Добавляем белый фон
    svgString += `<rect x="0" y="0" width="${qrSize}" height="${qrSize}" fill="#ffffff"/>`;
    
    const cellSize = qrContentSize / moduleCount;
    const centerX = moduleCount / 2;
    const centerY = moduleCount / 2;

    // Функция для рендеринга модуля
    function renderModule(x: number, y: number, isDark: boolean, color: string): string {
        if (moduleStyle === 'circle') {
            // Круглые модули
            const radius = cellSize / 2 * 0.9; // 90% размера для красоты
            return `<circle cx="${x + cellSize / 2}" cy="${y + cellSize / 2}" r="${radius}" fill="${color}"/>`;
        } else {
            // Квадратные модули (с опциональным скруглением)
            return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${roundedRadius}" ry="${roundedRadius}" fill="${color}"/>`;
        }
    }

    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            const isDark = qr.modules.get(row, col);
            // Сдвигаем координаты на margin
            const x = col * cellSize + margin;
            const y = row * cellSize + margin;
            
            // Вычисляем расстояние от центра до текущего модуля
            const dx = (col - centerX) * cellSize;
            const dy = (row - centerY) * cellSize;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Если модуль находится внутри круга для логотипа, делаем его белым
            if (distance < whiteCircleRadius) {
                svgString += renderModule(x, y, false, '#ffffff');
            } else {
                svgString += renderModule(x, y, false, isDark ? '#000000' : '#ffffff');
            }
        }
    }
    svgString += '</svg>';

    // Конвертируем SVG в PNG с высоким качеством
    const svgBuffer = Buffer.from(svgString);
    const pngBuffer = await sharp(svgBuffer)
        .png({ 
            quality: 100, 
            compressionLevel: 0,
            adaptiveFiltering: false,
            force: true
        })
        .toBuffer();
    fs.writeFileSync(qrCodePath, pngBuffer);

    // Если есть логотип, накладываем его
    if (logoPath) {
        try {
            let logoBuffer: Buffer;
            if (logoPath.endsWith('.svg')) {
                const svgBuffer = fs.readFileSync(logoPath);
                logoBuffer = await svg2png(svgBuffer, { width: logoSize, height: logoSize });
            } else {
                logoBuffer = fs.readFileSync(logoPath);
            }

            // Накладываем логотип в центр QR-кода с высоким качеством
            await sharp(qrCodePath)
                .composite([
                    {
                        input: logoBuffer,
                        top: Math.floor((qrSize - logoSize) / 2),
                        left: Math.floor((qrSize - logoSize) / 2)
                    }
                ])
                .png({ 
                    quality: 100, 
                    compressionLevel: 0,
                    adaptiveFiltering: false,
                    force: true
                })
                .toFile(qrFinalPath);

            // Удаляем промежуточный файл
            fs.unlinkSync(qrCodePath);
            return qrFinalPath;
        } catch (error) {
            console.error('Error adding logo to QR code:', error);
            return qrCodePath; // fallback: возвращаем обычный QR
        }
    }

    return qrCodePath;
}

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Настройка меню команд
async function setupCommands() {
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🚀 Запустить бота и показать приветствие' },
            { command: 'create', description: '🔄 Создать высококачественный QR-код' },
            { command: 'balance', description: '📊 Посмотреть баланс доступных QR-кодов' },
            { command: 'pay', description: '💳 Оплатить премиум-возможности' },
            { command: 'help', description: '📖 Показать справку по использованию бота' },
            { command: 'cancel', description: '❌ Отменить текущую операцию' }
        ]);
        console.log('Menu commands set successfully');
    } catch (error) {
        console.error('Error setting menu commands:', error);
    }
}

setupCommands();

// Очистка temp при запуске
cleanupTempFolder();

// Периодическая очистка temp каждые 6 часов
setInterval(cleanupTempFolder, 6 * 60 * 60 * 1000);

// Обработка команды /start
bot.command('start', async (ctx) => {
    try {
        // Создаем или получаем пользователя в БД
        const user = await database.getOrCreateUser(
            ctx.from.id,
            ctx.from.username || null,
            ctx.from.first_name || null,
            ctx.from.last_name || null
        );

        const welcomeMessage = `
👋 Привет! Я бот для генерации высококачественных QR-кодов.

📊 Твой баланс:
📱 Бесплатные QR-коды (400px): ${user.freeStandardAvailable} шт.
🖥️ Высокое качество (800px): ${user.premiumHighAvailable} шт.
🎨 Ультра качество (1600px): ${user.premiumUltraAvailable} шт.

📝 Как использовать:
1. Используйте команду /create или нажмите кнопку "Создать QR-код"
2. Выберите стиль модулей: квадраты, скругленные или круглые
3. Выберите качество: стандартное, высокое или ультра
4. Выберите тип QR-кода: с логотипом или без
5. Если вы выбрали с логотипом - отправьте логотип в формате SVG
6. Отправьте ссылку
7. Получите готовый высококачественный QR-код

✨ Особенности:
- Различные стили модулей (квадраты, скругленные, круглые)
- Поддержка разных уровней качества (до 1600x1600px)
- Четкие края без размытия
- Оптимизированное качество изображения

🔍 Доступные команды:
/start - Запустить бота
/create - Создать QR-код
/pay - Купить премиум пакеты
/help - Показать справку
/cancel - Отменить операцию
    `;

        await ctx.reply(welcomeMessage, Markup.keyboard([
            ['🔄 Создать QR-код']
        ]).resize());
    } catch (error) {
        console.error('Error in /start:', error);
        await ctx.reply('Произошла ошибка. Попробуйте еще раз через минуту.');
    }
});

// Обработка команды /create
bot.command('create', async (ctx) => {
    const userId = ctx.from.id;
    userStates.set(userId, { awaitingChoice: false, awaitingLogo: false, awaitingUrl: false, awaitingQuality: false, awaitingRenderSettings: true });

    await ctx.reply(
        'Выбери стиль модулей QR-кода:',
        Markup.keyboard([
            ['Квадраты', 'Скругленные'],
            ['Круглые'],
            ['🔙 Отменить']
        ]).resize()
    );
});

// Обработка команды /cancel
bot.command('cancel', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);

    await ctx.reply(
        '✅ Операция отменена.',
        Markup.keyboard([
            ['🔄 Создать QR-код']
        ]).resize()
    );
});

// Обработка команды /balance
bot.command('balance', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const user = await database.getUser(userId);
        
        if (!user) {
            await ctx.reply('Ошибка: пользователь не найден. Используйте /start');
            return;
        }
        
        // Получаем историю платежей
        const payments = await database.getUserPayments(userId);
        
        const balanceMessage = `
📊 Твой баланс доступных QR-кодов:

📱 Стандартное качество (400x400px)
   Доступно: ${user.freeStandardAvailable} шт.
   💰 Бесплатно (начальные 5 шт.)

🖥️ Высокое качество (800x800px)
   Доступно: ${user.premiumHighAvailable} шт.
   💰 Премиум (покупка за Stars)

🎨 Ультра качество (1600x1600px)
   Доступно: ${user.premiumUltraAvailable} шт.
   💰 Премиум (покупка за Stars)

💰 Всего потрачено: ${user.totalSpentStars} ⭐Stars

${payments.length > 0 ? '\n📋 Последние 3 покупки:\n' + 
    payments.slice(0, 3).map((p, i) => 
        `${i + 1}. ${p.productType === 'high_quality' ? '🖥️ High' : '🎨 Ultra'} - ${p.quantity} шт. (${p.amount}⭐)`
    ).join('\n') : ''}

💡 Советы:
• Начните с бесплатных QR-кодов (400x400px)
• High качество идеально для печати
• Ultra качество - максимальное качество

🔄 Создать QR: /create
💳 Купить пакеты: /pay
        `;
        
        await ctx.reply(balanceMessage);
    } catch (error) {
        console.error('Error in /balance:', error);
        await ctx.reply('Произошла ошибка при получении баланса. Попробуйте еще раз.');
    }
});

// Обработка команды /help
bot.command('help', async (ctx) => {
    const helpMessage = `
📝 Справка по использованию бота:

1. Нажмите кнопку "Создать QR-код" или команду /create
2. Выберите стиль модулей: Квадраты, Скругленные или Круглые
3. Выберите качество: стандартное (400px), высокое (800px) или ультра (1600px)
4. Выберите тип QR-кода: с логотипом или без
5. Если вы выбрали с логотипом - отправьте логотип в формате SVG
6. Отправьте ссылку или текст для QR-кода
7. Получите готовый высококачественный QR-код

✨ Стили модулей:
- Квадраты: классические угловатые модули
- Скругленные: квадраты со скругленными углами
- Круглые: круглые модули

✨ Уровни качества:
- 📱 Стандартное: 400x400px, бесплатно (5 шт.)
- 🖥️ Высокое: 800x800px, премиум (50⭐ за 10 шт.)
- 🎨 Ультра: 1600x1600px, премиум (75⭐ за 10 шт.)

📊 Команды:
/start - Запустить бота
/create - Создать QR-код
/balance - Посмотреть баланс доступных QR
/pay - Купить премиум пакеты
/help - Показать справку
/cancel - Отменить операцию

⚠️ Ограничения:
- Максимальная длина ссылки: 2048 символов
- Поддерживаются только текстовые ссылки
- Логотип должен быть в формате SVG
- Ультра качество может занимать больше времени
    `;

    await ctx.reply(helpMessage);
});

// Обработка команды /pay для оплаты премиум-возможностей
bot.command('pay', async (ctx) => {
    try {
        const user = await database.getUser(ctx.from.id);
        if (!user) {
            await ctx.reply('Ошибка: пользователь не найден. Используйте /start');
            return;
        }

        const message = `
💳 Премиум пакеты для QR-кодов

📦 Выберите пакет:

1️⃣ Пакет "Старт" (High качество)
   - 10 QR-кодов 800x800px
   - Цена: 1 ⭐Stars

2️⃣ Пакет "Профи" (High качество)
   - 50 QR-кодов 800x800px
   - Цена: 1 ⭐Stars

3️⃣ Пакет "VIP" (Ultra качество)
   - 10 QR-кодов 1600x1600px
   - Цена: 1 ⭐Stars

4️⃣ Пакет "Premium" (Ultra качество)
   - 50 QR-кодов 1600x1600px
   - Цена: 1 ⭐Stars

Ваш текущий баланс:
📱 Бесплатно: ${user.freeStandardAvailable} шт.
🖥️ High: ${user.premiumHighAvailable} шт.
🎨 Ultra: ${user.premiumUltraAvailable} шт.

Выберите номер пакета (1-4):
        `;

        await ctx.reply(message, Markup.inlineKeyboard([
            [
                Markup.button.callback('1️⃣ Старт (1⭐)', 'buy_high_10'),
                Markup.button.callback('2️⃣ Профи (1⭐)', 'buy_high_50')
            ],
            [
                Markup.button.callback('3️⃣ VIP (1⭐)', 'buy_ultra_10'),
                Markup.button.callback('4️⃣ Premium (1⭐)', 'buy_ultra_50')
            ]
        ]));
    } catch (error) {
        console.error('Error in /pay:', error);
        await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
    }
});

// Обработка нажатий на кнопки покупки
bot.action(/^buy_(high|ultra)_(\d+)$/, async (ctx) => {
    try {
        const match = ctx.match;
        const quality = match[1]; // 'high' или 'ultra'
        const quantity = parseInt(match[2]); // 10 или 50

        let title: string;
        let description: string;
        let amount: number;

        if (quality === 'high') {
            amount = 1; // Для тестирования
            title = quantity === 10 ? '⭐ Старт пакет' : '⭐ Профи пакет';
            description = `${quantity} QR-кодов высокого качества (800x800px)`;
        } else {
            amount = 1; // Для тестирования
            title = quantity === 10 ? '⭐ VIP пакет' : '⭐ Premium пакет';
            description = `${quantity} QR-кодов ультра качества (1600x1600px)`;
        }

        await ctx.replyWithInvoice({
            title,
            description,
            payload: `${quality}_${quantity}_${ctx.from.id}_${Date.now()}`,
            provider_token: '',
            currency: 'XTR',
            prices: [
                { label: `Пакет ${quantity} шт.`, amount },
            ],
        });

        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Error in buy action:', error);
        await ctx.answerCbQuery('Произошла ошибка. Попробуйте еще раз.');
    }
});

// Обработка pre-checkout query
bot.on('pre_checkout_query', async (ctx) => {
    try {
        // Проверяем доступность услуги
        await ctx.answerPreCheckoutQuery(true);
    } catch (error) {
        console.error('Error handling pre-checkout query:', error);
        try {
            // Пытаемся ответить на query с ошибкой
            await ctx.telegram.answerPreCheckoutQuery(ctx.preCheckoutQuery.id, false);
        } catch {
            // Игнорируем ошибку, если не можем ответить
            console.error('Could not send error message');
        }
    }
});

// Обработка успешного платежа
bot.on('successful_payment', async (ctx) => {
    try {
        const paymentId = ctx.message.successful_payment.telegram_payment_charge_id;
        const totalAmount = ctx.message.successful_payment.total_amount;
        const payload = ctx.message.successful_payment.invoice_payload;
        
        console.log(`Payment successful: ${paymentId}, amount: ${totalAmount} XTR, payload: ${payload}`);
        
        // Парсим payload для определения продукта
        const payloadParts = payload.split('_');
        if (payloadParts.length >= 3) {
            const quality = payloadParts[0]; // 'high' или 'ultra'
            const quantity = parseInt(payloadParts[1]); // 10 или 50
            
            // Сохраняем платеж в БД
            await database.savePayment({
                tgUserId: ctx.from.id,
                telegramPaymentChargeId: paymentId,
                payload: payload,
                amount: totalAmount,
                currency: 'XTR',
                status: 'completed',
                timestamp: new Date(),
                productType: quality === 'high' ? 'high_quality' : 'ultra_quality',
                quantity: quantity
            });
            
            // Добавляем доступы пользователю
            if (quality === 'high' || quality === 'ultra') {
                await database.addPremiumQR(ctx.from.id, quality as 'high' | 'ultra', quantity);
            }
            
            // Получаем обновленного пользователя для показа баланса
            const user = await database.getUser(ctx.from.id);
            
            await ctx.reply(
                `✅ Спасибо за оплату!\n\n` +
                `💳 ID платежа: ${paymentId}\n` +
                `💰 Сумма: ${totalAmount} ⭐Stars\n\n` +
                `📦 Получено:\n` +
                `${quality === 'high' ? '🖥️' : '🎨'} ${quantity} QR-кодов ${quality === 'high' ? 'высокого' : 'ультра'} качества\n\n` +
                `📊 Ваш баланс:\n` +
                `📱 Бесплатно: ${user?.freeStandardAvailable} шт.\n` +
                `🖥️ High: ${user?.premiumHighAvailable} шт.\n` +
                `🎨 Ultra: ${user?.premiumUltraAvailable} шт.\n\n` +
                `Теперь создавайте красивые QR-коды!`
            );
        }
    } catch (error) {
        console.error('Error handling successful payment:', error);
        await ctx.reply('Платеж получен, но произошла ошибка при обработке. Пожалуйста, свяжитесь с поддержкой через /paysupport');
    }
});

// Обработка команды /paysupport (требование Telegram)
bot.command('paysupport', async (ctx) => {
    await ctx.reply(
        '💳 Поддержка по платежам\n\n' +
        'Если у вас возникли проблемы с оплатой или доступом, пожалуйста:\n' +
        '1. Проверьте баланс Stars в @PremiumBot\n' +
        '2. Убедитесь, что платеж был успешно обработан\n' +
        '3. Напишите /support для связи с нами\n\n' +
        'Мы ответим в течение 24 часов.'
    );
});

// Обработка команды /support (требование Telegram)
bot.command('support', async (ctx) => {
    await ctx.reply(
        '🆘 Служба поддержки\n\n' +
        'Чем мы можем помочь?\n\n' +
        '📋 По использованию бота: /help\n' +
        '💳 По платежам: /paysupport\n' +
        '📖 Условия использования: /terms\n\n' +
        'Напишите ваш вопрос, и мы обязательно поможем!'
    );
});


bot.command('terms', async (ctx) => {
    const termsMessage = `
📋 УСЛОВИЯ ИСПОЛЬЗОВАНИЯ

Использование этого бота регулируется следующими условиями. Продолжая использовать бот, вы соглашаетесь со всеми нижеприведенными положениями.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ ОПИСАНИЕ УСЛУГИ
Бот предоставляет сервис генерации высококачественных QR-кодов с возможностью кастомизации стилей и добавления логотипов.

2️⃣ ОГРАНИЧЕНИЯ ИСПОЛЬЗОВАНИЯ
• Максимальная длина данных: 2048 символов
• Поддерживаемые форматы логотипов: SVG
• Максимальный размер логотипа: 10 МБ
• Одновременно может обрабатываться не более 5 запросов на пользователя

3️⃣ ИНТЕЛЛЕКТУАЛЬНАЯ СОБСТВЕННОСТЬ
• Контент, созданный вами с помощью бота, остается вашей собственностью
• Вы несете полную ответственность за содержимое QR-кодов
• Мы оставляем за собой право блокировать генерацию кодов для незаконного контента

4️⃣ ОГРАНИЧЕНИЕ ОТВЕТСТВЕННОСТИ
• Мы не гарантируем 100% бесперебойную работу бота
• Мы не несем ответственность за потерю данных или сбои сервиса
• Используется "как есть" без каких-либо гарантий
• Максимальная ответственность ограничена суммой произведенного платежа

5️⃣ ПЛАТЕЖИ И РЕФАНДЫ
• Все платежи через Telegram Stars являются окончательными
• Рефанды возможны только в случае критических технических сбоев
• Запросы на возврат должны быть поданы в течение 48 часов после платежа
• Мы оставляем за собой право отклонить необоснованные запросы

6️⃣ ЗАПРЕЩЕННАЯ ДЕЯТЕЛЬНОСТЬ
Запрещено использовать бот для:
• Создания контента для фишинга или мошенничества
• Распространения вредоносного ПО или вирусов
• Нарушения авторских прав третьих лиц
• Спама и массовых рассылок
• Создания кодов для запрещенного контента
• Обхода ограничений других сервисов

7️⃣ ПРИВАТНОСТЬ И ДАННЫЕ
• Мы не сохраняем созданные вами QR-коды
• Логотипы удаляются после обработки
• Минимальные метаданные хранятся в целях улучшения сервиса
• Ваш Telegram ID используется только для идентификации в пределах бота

8️⃣ МОДИФИКАЦИЯ УСЛУГИ
• Мы оставляем за собой право изменять функционал без предварительного уведомления
• Критические изменения будут объявлены заранее
• Использование бота после объявления изменений означает вашу согласность

9️⃣ БЛОКИРОВКА И ПРИОСТАНОВЛЕНИЕ
Мы имеем право заблокировать доступ пользователю за:
• Нарушение этих условий
• Создание запрещенного контента
• Попытки перегрузить сервис
• Подозрение на мошеннические действия

🔟 ПРИМЕНИМОЕ ПРАВО
Эти условия регулируются применимым законодательством. Любые споры разрешаются в соответствии с местным законодательством.

1️⃣1️⃣ КОНТАКТЫ И ПОДДЕРЖКА
Служба поддержки: /support
Вопросы по платежам: /paysupport
Email поддержки: support@qrbot.local

1️⃣2️⃣ СОГЛАСИЕ
Нажимая на команду /create, вы подтверждаете, что:
✅ Прочитали и поняли эти условия
✅ Согласны со всеми пунктами
✅ Несете полную ответственность за созданный контент
✅ Не будете использовать бот для незаконной деятельности

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Последнее обновление: октябрь 2025
Версия: 1.0
    `;

    await ctx.reply(termsMessage, { parse_mode: 'HTML' });
});


// Обработка нажатия кнопки "Создать QR-код"
bot.hears('🔄 Создать QR-код', async (ctx) => {
    const userId = ctx.from.id;
    userStates.set(userId, { awaitingChoice: false, awaitingLogo: false, awaitingUrl: false, awaitingQuality: false, awaitingRenderSettings: true });

    await ctx.reply(
        'Выбери стиль модулей QR-кода:',
        Markup.keyboard([
            ['Квадраты', 'Скругленные'],
            ['Круглые'],
            ['🔙 Отменить']
        ]).resize()
    );
});

// Обработка выбора стиля рендеринга
bot.hears('Квадраты', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingRenderSettings) {
        state.renderSettings = renderSettingsPresets['Квадраты'];
        state.awaitingRenderSettings = false;
        state.awaitingQuality = true;
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери качество QR-кода:',
            Markup.keyboard([
                ['📱 Стандартное (400px)', '🖥️ Высокое (800px)'],
                ['🎨 Ультра (1600px)'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('Скругленные', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingRenderSettings) {
        state.renderSettings = renderSettingsPresets['Скругленные'];
        state.awaitingRenderSettings = false;
        state.awaitingQuality = true;
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери качество QR-кода:',
            Markup.keyboard([
                ['📱 Стандартное (400px)', '🖥️ Высокое (800px)'],
                ['🎨 Ультра (1600px)'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('Круглые', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingRenderSettings) {
        state.renderSettings = renderSettingsPresets['Круглые'];
        state.awaitingRenderSettings = false;
        state.awaitingQuality = true;
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери качество QR-кода:',
            Markup.keyboard([
                ['📱 Стандартное (400px)', '🖥️ Высокое (800px)'],
                ['🎨 Ультра (1600px)'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

// Обработка выбора качества
bot.hears('📱 Стандартное (400px)', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingQuality) {
        state.awaitingQuality = false;
        state.awaitingChoice = true;
        state.quality = 'standard';
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери тип QR-кода:',
            Markup.keyboard([
                ['✅ С логотипом'],
                ['❌ Без логотипа'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('🖥️ Высокое (800px)', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingQuality) {
        // Проверяем доступность High качества
        const user = await database.getUser(userId);
        
        if (!user || user.premiumHighAvailable <= 0) {
            await ctx.reply(
                `❌ У вас нет доступных QR-кодов высокого качества (800x800px)\n\n` +
                `Ваш баланс: ${user?.premiumHighAvailable || 0} шт.\n\n` +
                `💳 Чтобы получить доступ, используйте команду /pay\n\n` +
                `📱 Или выберите бесплатное качество (400x400px)`,
                Markup.keyboard([
                    ['📱 Стандартное (400px)', '🎨 Ультра (1600px)'],
                    ['🔙 Отменить']
                ]).resize()
            );
            return;
        }
        
        state.awaitingQuality = false;
        state.awaitingChoice = true;
        state.quality = 'high';
        userStates.set(userId, state);

        await ctx.reply(
            `✅ Есть доступ! (Осталось: ${user.premiumHighAvailable} шт.)\n\nВыбери тип QR-кода:`,
            Markup.keyboard([
                ['✅ С логотипом'],
                ['❌ Без логотипа'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('🎨 Ультра (1600px)', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingQuality) {
        // Проверяем доступность Ultra качества
        const user = await database.getUser(userId);
        
        if (!user || user.premiumUltraAvailable <= 0) {
            await ctx.reply(
                `❌ У вас нет доступных QR-кодов ультра качества (1600x1600px)\n\n` +
                `Ваш баланс: ${user?.premiumUltraAvailable || 0} шт.\n\n` +
                `💳 Чтобы получить доступ, используйте команду /pay\n\n` +
                `📱 Или выберите другое качество`,
                Markup.keyboard([
                    ['📱 Стандартное (400px)', '🖥️ Высокое (800px)'],
                    ['🔙 Отменить']
                ]).resize()
            );
            return;
        }
        
        state.awaitingQuality = false;
        state.awaitingChoice = true;
        state.quality = 'ultra';
        userStates.set(userId, state);

        await ctx.reply(
            `✅ Есть доступ! (Осталось: ${user.premiumUltraAvailable} шт.)\n\nВыбери тип QR-кода:`,
            Markup.keyboard([
                ['✅ С логотипом'],
                ['❌ Без логотипа'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

// Обработка нажатия кнопки "С логотипом"
bot.hears('✅ С логотипом', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingChoice) {
        state.awaitingChoice = false;
        state.awaitingLogo = true;
        state.awaitingUrl = false;
        userStates.set(userId, state);

        await ctx.reply(
            'Отправь логотип в формате SVG.',
            Markup.keyboard([
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

// Обработка нажатия кнопки "Без логотипа"
bot.hears('❌ Без логотипа', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingChoice) {
        state.awaitingChoice = false;
        state.awaitingLogo = false;
        state.awaitingUrl = true;
        userStates.set(userId, state);

        const qualityText = state.quality === 'ultra' ? 'ультра' : 
                           state.quality === 'high' ? 'высоком' : 'стандартном';
        
        await ctx.reply(
            `Пришли ссылку или текст для QR-кода в ${qualityText} качестве.`,
            Markup.keyboard([
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

// Обработка нажатия кнопки "Отменить"
bot.hears('🔙 Отменить', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);

    await ctx.reply(
        '✅ Операция отменена.',
        Markup.keyboard([
            ['🔄 Создать QR-код']
        ]).resize()
    );
});

// Обработка получения фото
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);

    if (state?.awaitingLogo) {
        try {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const file = await ctx.telegram.getFile(photo.file_id);
            const logoPath = path.join(__dirname, 'temp', `logo_${Date.now()}.svg`);
            
            // Скачиваем логотип
            await downloadFile(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`, logoPath);

            state.logoPath = logoPath;
            state.awaitingLogo = false;
            state.awaitingUrl = true;
            userStates.set(userId, state);

            const qualityText = state.quality === 'ultra' ? 'ультра' : 
                               state.quality === 'high' ? 'высоком' : 'стандартном';
            
            await ctx.reply(
                `Теперь пришли ссылку или текст для QR-кода в ${qualityText} качестве.`,
                Markup.keyboard([
                    ['🔙 Отменить']
                ]).resize()
            );
        } catch (error) {
            console.error('Error processing logo:', error);
            await ctx.reply('Произошла ошибка при обработке логотипа. Пожалуйста, попробуйте еще раз.');
        }
    }
});

// Обработка получения SVG-документа
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);

    if (state?.awaitingLogo) {
        try {
            const document = ctx.message.document;
            // Проверяем, что это SVG
            if (!document.file_name || !document.file_name.endsWith('.svg')) {
                await ctx.reply('Пожалуйста, отправьте логотип в формате SVG.');
                return;
            }
            const file = await ctx.telegram.getFile(document.file_id);
            const logoPath = path.join(__dirname, 'temp', `logo_${Date.now()}.svg`);
            await downloadFile(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`, logoPath);

            state.logoPath = logoPath;
            state.awaitingLogo = false;
            state.awaitingUrl = true;
            userStates.set(userId, state);

            const qualityText = state.quality === 'ultra' ? 'ультра' : 
                               state.quality === 'high' ? 'высоком' : 'стандартном';
            
            await ctx.reply(
                `Теперь пришли ссылку или текст для QR-кода в ${qualityText} качестве.`,
                Markup.keyboard([
                    ['🔙 Отменить']
                ]).resize()
            );
        } catch (error) {
            console.error('Error processing SVG logo:', error);
            await ctx.reply('Произошла ошибка при обработке логотипа. Пожалуйста, попробуйте еще раз.');
        }
    }
});

// Обработка текстовых сообщений
bot.on(message('text'), async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const text = ctx.message.text;

    if (state?.awaitingUrl) {
        let processedUrl: string;
        try {
            processedUrl = processUrl(text);
            new URL(processedUrl);
        } catch {
            await ctx.reply('Пожалуйста, отправьте корректную ссылку!');
            return;
        }

        try {
            const quality = state.quality || 'standard';
            const renderSettings = state.renderSettings;
            
            // Проверяем и списываем доступы в зависимости от качества
            let hasAccess = false;
            let remaining = 0;
            
            if (quality === 'standard') {
                hasAccess = await database.useFreeStandardQR(userId);
                if (hasAccess) {
                    const user = await database.getUser(userId);
                    remaining = user?.freeStandardAvailable || 0;
                } else {
                    await ctx.reply(
                        '❌ У вас закончились бесплатные QR-коды!\n\n' +
                        '💳 Используйте /pay чтобы купить премиум пакеты.'
                    );
                    return;
                }
            } else if (quality === 'high') {
                hasAccess = await database.usePremiumHighQR(userId);
                if (hasAccess) {
                    const user = await database.getUser(userId);
                    remaining = user?.premiumHighAvailable || 0;
                } else {
                    await ctx.reply(
                        '❌ У вас нет доступных QR-кодов высокого качества!\n\n' +
                        '💳 Используйте /pay чтобы купить пакет.'
                    );
                    return;
                }
            } else if (quality === 'ultra') {
                hasAccess = await database.usePremiumUltraQR(userId);
                if (hasAccess) {
                    const user = await database.getUser(userId);
                    remaining = user?.premiumUltraAvailable || 0;
                } else {
                    await ctx.reply(
                        '❌ У вас нет доступных QR-кодов ультра качества!\n\n' +
                        '💳 Используйте /pay чтобы купить пакет.'
                    );
                    return;
                }
            }
            
            if (!hasAccess) {
                return;
            }
            
            const qrCodePath = await generateQRWithLogo(processedUrl, state.logoPath, quality, renderSettings);
            
            // Отправляем QR-код
            await ctx.replyWithPhoto({ source: qrCodePath });

            // Очищаем состояние пользователя
            userStates.delete(userId);

            // Показываем оставшееся количество
            const qualityEmoji = quality === 'standard' ? '📱' : quality === 'high' ? '🖥️' : '🎨';
            const qualityName = quality === 'standard' ? 'Стандарт' : quality === 'high' ? 'Высокое' : 'Ультра';
            
            // Обновляем клавиатуру, убирая кнопку "Отменить"
            await ctx.reply(
                `✅ QR-код успешно создан (${qualityName})!\n\n` +
                `${qualityEmoji} Осталось: ${remaining} шт.`,
                Markup.keyboard([
                    ['🔄 Создать QR-код']
                ]).resize()
            );

            // Удаляем QR-файл сразу после отправки
            if (fs.existsSync(qrCodePath)) {
                try {
                    fs.unlinkSync(qrCodePath);
                } catch (error) {
                    console.error(`Ошибка при удалении QR-файла ${qrCodePath}:`, error);
                }
            }

            // Удаляем логотип, если он был использован
            if (state.logoPath && fs.existsSync(state.logoPath)) {
                try {
                    fs.unlinkSync(state.logoPath);
                } catch (error) {
                    console.error(`Ошибка при удалении логотипа ${state.logoPath}:`, error);
                }
            }

        } catch (error) {
            console.error('Error generating QR code:', error);
            await ctx.reply('Произошла ошибка при генерации QR-кода. Пожалуйста, попробуйте позже.');
        }
    }
});

// Инициализация и запуск
async function startBot() {
    try {
        // Инициализируем базу данных
        await database.initialize();
        console.log('✅ Database initialized');

        // Запускаем бота
        await bot.launch();
        console.log('✅ Bot started successfully!');
    } catch (error) {
        console.error('❌ Error starting bot:', error);
        process.exit(1);
    }
}

startBot();

// Обработка завершения работы
process.once('SIGINT', async () => {
    cleanupTempFolder();
    await database.close();
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', async () => {
    cleanupTempFolder();
    await database.close();
    bot.stop('SIGTERM');
    process.exit(0);
}); 