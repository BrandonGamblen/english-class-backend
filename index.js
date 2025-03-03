const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

const URI = process.env.MONGO_URI;
if (!URI) {
    console.error('MONGO_URI environment variable is not set');
    process.exit(1);
}

const client = new MongoClient(URI, {
    tls: true,
    minTLSVersion: 'TLSv1.2' // Enforce TLS 1.2+
});

async function ensureConnected() {
    try {
        if (!client.topology || !client.topology.isConnected()) {
            await client.connect();
            console.log('Reconnected to MongoDB');
        }
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        throw err;
    }
}

async function connectDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
}

connectDB().then(() => {
    app.get('/', (req, res) => {
        res.send('Hello, this is your English class server!');
    });

    app.post('/submit-answers', async (req, res) => {
        const { studentName, classId, answers } = req.body;
        try {
            await ensureConnected();
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
        const password = req.query.password;
        if (password !== 'Teach2025') {
            return res.status(401).send('Unauthorized');
        }
        try {
            await ensureConnected();
            const db = client.db('englishLessons');
            const submissions = await db.collection('submissions').find().toArray();
            res.json(submissions);
        } catch (err) {
            console.error('Error fetching submissions:', err);
            res.status(500).send('Error fetching submissions');
        }
    });

    app.post('/teacher/mark', async (req, res) => {
        const password = req.query.password;
        if (password !== 'Teach2025') {
            return res.status(401).send('Unauthorized');
        }
        const { submissionId, grade } = req.body;
        try {
            await ensureConnected();
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
        const { studentName } = req.query;
        if (!studentName) {
            return res.status(400).send('Student name required');
        }
        try {
            await ensureConnected();
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

    app.listen(process.env.PORT || 3000, () => {
        console.log(`Server running on port ${process.env.PORT || 3000}`);
    });
}).catch(() => {
    console.error('Failed to connect to MongoDB, server not started');
    process.exit(1);
});