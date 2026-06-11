const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

// Історія повідомлень
let messagesHistory = [];

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Користувач підключився');

    // Відправляємо історію новому клієнту
    socket.emit('load history', messagesHistory);

    socket.on('chat message', (data) => {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Створюємо безпечний об'єкт повідомлення
        let msgObject = {
            text: '',
            user: 'Користувач',
            avatar: 'U',
            time: timeString
        };

        // Перевіряємо, що саме прислав клієнт — об'єкт чи звичайну строку
        if (typeof data === 'object' && data !== null) {
            msgObject.text = data.text || '';
            msgObject.user = data.user || 'Користувач';
            msgObject.avatar = data.avatar || 'U';
        } else {
            msgObject.text = data;
        }

        // Зберігаємо в історію
        messagesHistory.push(msgObject);
        if (messagesHistory.length > 100) messagesHistory.shift();

        // Шлемо всім
        io.emit('chat message', msgObject);
    });

    socket.on('disconnect', () => {
        console.log('Користувач відключився');
    });
});

http.listen(PORT, () => {
    console.log(`Сервер працює на порту ${PORT}`);
});
