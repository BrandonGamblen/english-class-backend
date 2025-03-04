const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

const URI = process.env.MONGO_URI;
if (!URI) {
    console.error('MONGO_URI environment variable is not set');
    process.exit(1);
}

const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'Teach2025'; // Fallback for local testing

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

connectDB().then(() => {
    app.get('/', (req, res) => {
        console.log('Handling GET /');
        res.send('Hello, this is your English class server!');
    });

    app.post('/submit-answers', async (req, res) => {
        console.log('Handling POST /submit-answers');
        const { studentName, classId, answers } = req.body;
        try {
            if (!await ensureConnected()) {
                throw new Error('Database not connected');
            }
            const db = client.db('englishLessons');
            await db.collection('submissions').insertOne({
                studentName,
                classId,
                answers,
                date: new Date(),
                grade: null
            });
            console.log(`Saved answers from ${studentName} for ${classId}`);
            res.send('Answers saved!');
        } catch (err) {
            console.error('Error saving answers:', err);
            res.status(500).send('Error saving answers');
        }
    });

    app.get('/teacher', async (req, res) => {
        console.log('Handling GET /teacher');
        const password = req.query.password;
        if (password !== TEACHER_PASSWORD) { // Updated to use env variable
            return res.status(401).send('Unauthorized');
        }
        try {
            if (!await ensureConnected()) {
                throw new Error('Database not connected');
            }
            const db = client.db('englishLessons');
            const submissions = await db.collection('submissions').find().toArray();
            console.log('Fetched submissions:', submissions.length);
            res.json(submissions);
        } catch (err) {
            console.error('Error fetching submissions:', err);
            res.status(500).send('Error fetching submissions');
        }
    });

    app.post('/teacher/mark', async (req, res) => {
        console.log('Handling POST /teacher/mark');
        const password = req.query.password;
        if (password !== TEACHER_PASSWORD) { // Updated to use env variable
            return res.status(401).send('Unauthorized');
        }
        const { submissionId, grade } = req.body;
        try {
            if (!await ensureConnected()) {
                throw new Error('Database not connected');
            }
            const db = client.db('englishLessons');
            const result = await db.collection('submissions').updateOne(
                { _id: new ObjectId(submissionId) },
                { $set: { grade } }
            );
            if (result.matchedCount === 0) {
                throw new Error('No submission found with that ID');
            }
            console.log(`Marked submission ${submissionId} with grade ${grade}`);
            res.send('Grade saved!');
        } catch (err) {
            console.error('Detailed error marking submission:', err.message);
            res.status(500).send(`Error marking submission: ${err.message}`);
        }
    });

    app.get('/grades', async (req, res) => {
        console.log('Handling GET /grades');
        const { studentName } = req.query;
        if (!studentName) {
            return res.status(400).send('Student name required');
        }
        try {
            if (!await ensureConnected()) {
                throw new Error('Database not connected');
            }
            const db = client.db('englishLessons');
            const grades = await db.collection('submissions')
                .find({ studentName })
                .toArray();
            console.log(`Fetched ${grades.length} grades for ${studentName}`);
            res.json(grades);
        } catch (err) {
            console.error('Error fetching grades:', err);
            res.status(500).send('Error fetching grades');
        }
    });

    app.listen(process.env.PORT || 10000, () => {
        console.log(`Server running on port ${process.env.PORT || 10000}`);
    });
}).catch(err => {
    console.error('Fatal startup error:', err);
    setTimeout(connectDB, 5000);
});