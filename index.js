const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB setup
const uri = process.env.MONGO_URI; 
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
let attendanceCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db('attendance'); 
    attendanceCollection = db.collection('userSessions'); // collection name
    console.log('MongoDB connected');
  } catch (err) {
    console.error(err);
  }
}
connectDB();

// Routes
app.get('/', (req, res) => {
  res.send('Attendence Api is running');
});

// GET all attendance
app.get('/userSessions', async (req, res) => {
  try {
    const data = await attendanceCollection.find().sort({ date: -1 }).toArray();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/total-employees', async (req, res) => {
  try {
    const result = await client.db('attendance')
      .collection('userSessions')
      .aggregate([
        { $group: { _id: "$employee" } }, 
        { $count: "totalEmployees" }    
      ])
      .toArray();

    res.json({ totalEmployees: result[0]?.totalEmployees || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/dashboard-stats', async (req, res) => {
  try {
    const collection = client.db('attendance').collection('userSessions');

    // Aggregate stats
    const stats = await collection.aggregate([
      {
        $project: {
          employee: 1,
          workDurationMs: { $subtract: ["$logoutTime", "$loginTime"] },
          loginHour: { $hour: "$loginTime" },
          loginMinute: { $minute: "$loginTime" },
          logoutHour: { $hour: "$logoutTime" },
          logoutMinute: { $minute: "$logoutTime" }
        }
      },
      {
        $group: {
          _id: null,
          totalEmployees: { $addToSet: "$employee" },
          avgLoginHour: { $avg: "$loginHour" },
          avgLoginMinute: { $avg: "$loginMinute" },
          avgLogoutHour: { $avg: "$logoutHour" },
          avgLogoutMinute: { $avg: "$logoutMinute" },
          avgWorkMs: { $avg: "$workDurationMs" }
        }
      },
      {
        $project: {
          totalEmployees: { $size: "$totalEmployees" },
          avgLoginTime: {
            $concat: [
              { $toString: { $round: ["$avgLoginHour", 0] } },
              ":",
              { $toString: { $round: ["$avgLoginMinute", 0] } }
            ]
          },
          avgLogoutTime: {
            $concat: [
              { $toString: { $round: ["$avgLogoutHour", 0] } },
              ":",
              { $toString: { $round: ["$avgLogoutMinute", 0] } }
            ]
          },
         avgWorkHours: { 
      $round: [{ $divide: ["$avgWorkMs", 1000 * 60 * 60] }, 1] 
    }
        }
      }
    ]).toArray();

    res.json(stats[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/employee-monthly-hours', async (req, res) => {
  try {
    const collection = client.db('attendance').collection('userSessions');

    const monthlyHours = await collection.aggregate([
      {
        $project: {
          employee: 1,
          year: { $year: "$date" },
          month: { $month: "$date" },
          workMs: { $subtract: ["$logoutTime", "$loginTime"] } // working time in ms
        }
      },
      {
        $group: {
          _id: { employee: "$employee", year: "$year", month: "$month" },
          totalWorkMs: { $sum: "$workMs" }
        }
      },
      {
        $project: {
          _id: 0,
          employee: "$_id.employee",
          year: "$_id.year",
          month: "$_id.month",
          totalWorkHours: { $round: [{ $divide: ["$totalWorkMs", 1000 * 60 * 60] }, 2] } // convert ms → hours
        }
      },
      { $sort: { employee: 1, year: 1, month: 1 } }
    ]).toArray();

    res.json(monthlyHours);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/monthly-overtime", async (req, res) => {
  try {
    const collection = client.db("attendance").collection("userSessions");

    const overtimeData = await collection.aggregate([
      {
        $project: {
          employee: 1,
          month: { $month: "$date" },
          workHours: { $divide: [{ $subtract: ["$logoutTime", "$loginTime"] }, 1000 * 60 * 60] }, // hours
        }
      },
      {
        $project: {
          employee: 1,
          month: 1,
          overtime: {
            $cond: [{ $gt: ["$workHours", 8] }, { $subtract: ["$workHours", 8] }, 0]
          }
        }
      },
      {
        $group: {
          _id: "$month",
          totalOvertime: { $sum: "$overtime" }
        }
      },
      {
        $project: {
          _id: 0,
          month: "$_id",
          totalOvertime: { $round: ["$totalOvertime", 2] }
        }
      },
      { $sort: { month: 1 } }
    ]).toArray();

    res.json(overtimeData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/avg-break-per-month", async (req, res) => {
  try {
    const collection = client.db("attendance").collection("userSessions");

    const avgBreak = await collection.aggregate([
      {
        $project: {
          month: { $month: "$date" },
          workHours: { $divide: [{ $subtract: ["$logoutTime", "$loginTime"] }, 1000 * 60 * 60] }
        }
      },
      {
        $project: {
          month: 1,
          breakHours: {
            $cond: [{ $gt: ["$workHours", 8] }, { $subtract: ["$workHours", 8] }, 0]
          }
        }
      },
      {
        $group: {
          _id: "$month",
          avgBreakHours: { $avg: "$breakHours" }
        }
      },
      {
        $project: {
          _id: 0,
          month: "$_id",
          avgBreakHours: { $round: ["$avgBreakHours", 2] } // 2 decimal points
        }
      },
      { $sort: { month: 1 } }
    ]).toArray();

    res.json(avgBreak);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/total-break-per-month", async (req, res) => {
  try {
    const collection = client.db("attendance").collection("userSessions");

    const breakData = await collection.aggregate([
      {
        $project: {
          month: { $month: "$date" },
          workHours: { $divide: [{ $subtract: ["$logoutTime", "$loginTime"] }, 1000 * 60 * 60] }
        }
      },
      {
        $project: {
          month: 1,
          breakHours: {
            $cond: [{ $gt: ["$workHours", 8] }, { $subtract: ["$workHours", 8] }, 0]
          }
        }
      },
      {
        $group: {
          _id: "$month",
          totalBreakHours: { $sum: "$breakHours" }
        }
      },
      {
        $project: {
          _id: 0,
          month: "$_id",
          totalBreakHours: { $round: ["$totalBreakHours", 2] }
        }
      },
      { $sort: { month: 1 } }
    ]).toArray();

    res.json(breakData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/top-working-hours", async (req, res) => {
  try {
    const collection = client.db("attendance").collection("userSessions");

    const topEmployees = await collection.aggregate([
      {
        $project: {
          employee: 1,
          workHours: { $divide: [{ $subtract: ["$logoutTime", "$loginTime"] }, 1000 * 60 * 60] }
        }
      },
      {
        $group: {
          _id: "$employee",
          totalHours: { $sum: "$workHours" }
        }
      },
      { $sort: { totalHours: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          employee: "$_id",
          totalHours: { $round: ["$totalHours", 2] }
        }
      }
    ]).toArray();

    res.json(topEmployees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/bottom-working-hours", async (req, res) => {
  try {
    const collection = client.db("attendance").collection("userSessions");

    const bottomEmployees = await collection.aggregate([
      {
        $project: {
          employee: 1,
          workHours: { $divide: [{ $subtract: ["$logoutTime", "$loginTime"] }, 1000 * 60 * 60] }
        }
      },
      {
        $group: {
          _id: "$employee",
          totalHours: { $sum: "$workHours" }
        }
      },
      { $sort: { totalHours: 1 } }, // Ascending
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          employee: "$_id",
          totalHours: { $round: ["$totalHours", 2] }
        }
      }
    ]).toArray();

    res.json(bottomEmployees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/employee-summary", async (req, res) => {
  try {
    const collection = client.db("attendance").collection("userSessions");

    const summary = await collection.aggregate([
      {
        $project: {
          employee: 1,
          workHours: {
            $divide: [{ $subtract: ["$logoutTime", "$loginTime"] }, 1000 * 60 * 60]
          }
        }
      },
      {
        $group: {
          _id: "$employee",
          totalHours: { $sum: "$workHours" },
          avgHours: { $avg: "$workHours" },
          maxHours: { $max: "$workHours" },
          minHours: { $min: "$workHours" },
          daysWorked: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          employee: "$_id",
          totalHours: { $round: ["$totalHours", 2] },
          avgHours: { $round: ["$avgHours", 2] },
          maxHours: { $round: ["$maxHours", 2] },
          minHours: { $round: ["$minHours", 2] },
          daysWorked: 1
        }
      },
      { $sort: { totalHours: -1 } } // Sort by most worked
    ]).toArray();

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
