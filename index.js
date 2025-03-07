const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();

app.use(express.json());

const URI = process.env.MONGO_URI;
if (!URI) {
    console.error('MONGO_URI environment variable is not set');
    process.exit(1);
}

const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'Teach2025';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const client = new MongoClient(URI);

async function ensureConnected() {
    try {
        if (!client.topology || !client.topology.isConnected()) {
            console.log('Attempting to reconnect to MongoDB...');
            await client.connect();
            console.log('Reconnected to MongoDB');
        }
        return true;
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return false;
    }
}

async function connectDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('Initial MongoDB connection error:', err);
        await new Promise(resolve => setTimeout(resolve, 5000));
        await connectDB();
    }
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const auth = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).send('No token');
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = client.db('englishLessons');
        const user = await db.collection('users').findOne({ _id: new ObjectId(decoded.id) });
        if (!user) return res.status(401).send('Invalid token');
        req.user = user;
        next();
    } catch (e) {
        res.status(401).send('Invalid token');
    }
};

connectDB().then(() => {
    app.get('/', (req, res) => {
        console.log('Handling GET /');
        res.send('Hello, this is your English class server!');
    });

    app.post('/login', async (req, res) => {
        console.log('Handling POST /login');
        const { username, password } = req.body;
        try {
            if (!await ensureConnected()) throw new Error('Database not connected');
            const db = client.db('englishLessons');
            const user = await db.collection('users').findOne({ username });
            if (!user || !bcrypt.compareSync(password, user.password)) {
                return res.status(401).send('Invalid credentials');
            }
            const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
            res.json({ token });
        } catch (err) {
            console.error('Error logging in:', err);
            res.status(500).send('Error logging in');
        }
    });

    app.get('/classes', auth, async (req, res) => {
        console.log('Handling GET /classes');
        if (req.user.role !== 'student') return res.status(403).send('Forbidden');
        try {
            if (!await ensureConnected()) throw new Error('Database not connected');
            const db = client.db('englishLessons');
            const classes = await db.collection('classes')
                .find({ students: new ObjectId(req.user._id) })
                .toArray();
            res.json(classes);
        } catch (err) {
            console.error('Error fetching classes:', err);
            res.status(500).send('Error fetching classes');
        }
    });

    app.get('/classes/:classId/lessons', auth, async (req, res) => {
        console.log('Handling GET /classes/:classId/lessons');
        try {
            if (!await ensureConnected()) throw new Error('Database not connected');
            const db = client.db('englishLessons');
            const lessons = await db.collection('lessons')
                .find({ classId: req.params.classId })
                .toArray();
            res.json(lessons);
        } catch (err) {
            console.error('Error fetching lessons:', err);
            res.status(500).send('Error fetching lessons');
        }
    });

    app.post('/submit-answers', auth, async (req, res) => {
        console.log('Handling POST /submit-answers');
        const { classId, lessonId, answers } = req.body;
        try {
            if (!await ensureConnected()) throw new Error('Database not connected');
            const db = client.db('englishLessons');
            await db.collection('submissions').insertOne({
                studentName: req.user.username,
                classId,
                lessonId,
                answers: Array.isArray(answers) ? answers.map((a, i) => ({ question: `Q${i+1}`, answer: a })) : answers,
                date: new Date(),
                grade: null
            });
            res.send('Answers saved!');
        } catch (err) {
            console.error('Error saving answers:', err);
            res.status(500).send('Error saving answers');
        }
    });

    app.get('/teacher', auth, async (req, res) => {
        console.log('Handling GET /teacher');
        if (req.user.role !== 'teacher' || req.query.password !== TEACHER_PASSWORD) {
            return res.status(401).send('Unauthorized');
        }
        try {
            if (!await ensureConnected()) throw new Error('Database not connected');
            const db = client.db('englishLessons');
            const submissions = await db.collection('submissions').find().toArray();
            res.json(submissions);
        } catch (err) {
            console.error('Error fetching submissions:', err);
            res.status(500).send('Error fetching submissions');
        }
    });

    app.post('/teacher/mark', auth, async (req, res) => {
        console.log('Handling POST /teacher/mark');
        if (req.user.role !== 'teacher' || req.query.password !== TEACHER_PASSWORD) {
            return res.status(401).send('Unauthorized');
        }
        const { submissionId, grade } = req.body;
        try {
            if (!await ensureConnected()) throw new Error('Database not connected');
            const db = client.db('englishLessons');
            const result = await db.collection('submissions').updateOne(
                { _id: new ObjectId(submissionId) },
                { $set: { grade } }
            );
            if (result.matchedCount === 0) throw new Error('No submission found');
            res.send('Grade saved!');
        } catch (err) {
            console.error('Error marking submission:', err);
            res.status(500).send('Error marking submission');
        }
    });

    app.get('/grades', async (req, res) => {
        console.log('Handling GET /grades');
        const { studentName } = req.query;
        if (!studentName) return res.status(400).send('Student name required');
        try {
            if (!await ensureConnected()) throw new Error('Database not connected');
            const db = client.db('englishLessons');
            const grades = await db.collection('submissions')
                .find({ studentName })
                .toArray();
            res.json(grades);
        } catch (err) {
            console.error('Error fetching grades:', err);
            res.status(500).send('Error fetching grades');
        }
    });

    async function addTestData() {
        const db = client.db('englishLessons');
        const hashedStudent = bcrypt.hashSync('pass123', 10);
        const hashedTeacher = bcrypt.hashSync('Teach2025', 10);
        const student = await db.collection('users').insertOne({
            username: 'student1',
            password: hashedStudent,
            role: 'student'
        });
        const teacher = await db.collection('users').insertOne({
            username: 'teacher1',
            password: hashedTeacher,
            role: 'teacher'
        });
        const classDoc = await db.collection('classes').insertOne({
            classId: 'Class1',
            name: 'English 101',
            students: [student.insertedId]
        });
        await db.collection('lessons').insertOne({
            classId: 'Class1',
            title: 'Lesson 1: Intro',
            content: 'Welcome to English class!',
            questions: [{ question: 'What’s your name?' }]
        });
        console.log('Test data added');
    }

    app.listen(process.env.PORT || 10000, () => {
        console.log(`Server running on port ${process.env.PORT || 10000}`);
        addTestData(); // Runs once on startup
    });
}).catch(err => {
    console.error('Fatal startup error:', err);
    setTimeout(connectDB, 5000);
});