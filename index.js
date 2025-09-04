const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
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
function buildMatchStage(query) {
  const { year, months } = query;
  const conditions = [];
  const monthNameToNumber = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
  };

  if (year) conditions.push({ $eq: [{ $year: "$dateObj" }, parseInt(year)] });

  if (months) {
    const monthArray = months
      .split(",")
      .map(m => monthNameToNumber[m.trim()])
      .filter(Boolean);
    if (monthArray.length) conditions.push({ $in: [{ $month: "$dateObj" }, monthArray] });
  }

  if (!conditions.length) return null;

  return { $expr: conditions.length > 1 ? { $and: conditions } : conditions[0] };
}



const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir); // create folder if missing
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage: storage });

// CSV Upload Route

// app.post("/upload-csv", upload.single("csvFile"), async (req, res) => {
//   try {
//     const filePath = req.file.path; // multer gives the file path
//     const collection = client.db("attendance").collection("userSessions");

//     const rows = [];

//     fs.createReadStream(filePath)
//   .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
//   .on("data", (data) => {
//     rows.push({
//       employee: data["Name"]?.trim() || null,
//       date: data["Log In"] ? new Date(data["Log In"].trim()) : null,
//       loginTime: data["Log In"] ? new Date(data["Log In"].trim()) : null,
//       logoutTime: data["Log Out"] ? new Date(data["Log Out"].trim()) : null,
//     });
//   })
//   .on("end", async () => {
//     await collection.deleteMany({});
//     if (rows.length) {
//       await collection.insertMany(rows);
//     }
//     res.json({ message: "CSV uploaded and data saved", count: rows.length });
//   });

//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });
app.post("/upload-csv", upload.single("csvFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = req.file.path;
    const collection = client.db("attendance").collection("userSessions");

    const rows = [];

    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
      .on("data", (data) => {
        const emp = data["Name"]?.trim();
        const loginTime = data["Log In"]?.trim();
        const logoutTime = data["Log Out"]?.trim();
        const date = data["date"]?.trim();

        // Skip rows with missing fields
        if (emp && loginTime && logoutTime && date) {
          rows.push({ employee: emp, date, loginTime, logoutTime });
        }
      })
      .on("end", async () => {
        try {
          // Optional: clear previous data
          await collection.deleteMany({});

          if (rows.length > 0) {
            await collection.insertMany(rows);
          }

          res.json({ message: "CSV uploaded and saved successfully!", count: rows.length });
        } catch (dbErr) {
          console.error(dbErr);
          res.status(500).json({ message: "Database insert failed" });
        }
      });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


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
function parseTimeToMs(timeStr) {
  // e.g., "8:19:00 AM"
  if (!timeStr) return 0;
  const [time, modifier] = timeStr.split(" ");
  let [hours, minutes, seconds] = time.split(":").map(Number);

  if (modifier === "PM" && hours !== 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;

  return (hours * 60 * 60 + minutes * 60 + seconds) * 1000; // ms
}

// app.get("/dashboard-stats", async (req, res) => {
//   try {
//     const matchStage = buildMatchStage(req.query);

//     // Convert string date to Date for filtering
//     const rows = matchStage
//       ? await attendanceCollection.aggregate([
//           { $addFields: { dateObj: { $dateFromString: { dateString: "$date" } } } },
//           { $match: matchStage }
//         ]).toArray()
//       : await attendanceCollection.aggregate([
//           { $addFields: { dateObj: { $dateFromString: { dateString: "$date" } } } }
//         ]).toArray();

//     const totalEmployees = new Set();
//     let totalWorkMs = 0;
//     let totalLoginMs = 0;
//     let totalLogoutMs = 0;

//     rows.forEach(row => {
//       if (!row.employee || !row.loginTime || !row.logoutTime) return;

//       totalEmployees.add(row.employee);

//       const loginMs = parseTimeToMs(row.loginTime);
//       const logoutMs = parseTimeToMs(row.logoutTime);

//       totalLoginMs += loginMs;
//       totalLogoutMs += logoutMs;
//       totalWorkMs += logoutMs - loginMs;
//     });

//     const count = rows.length || 1;

//     const avgLoginMs = totalLoginMs / count;
//     const avgLogoutMs = totalLogoutMs / count;
//     const avgWorkHours = totalWorkMs / count / (1000 * 60 * 60);

//     function msToTime(ms) {
//       const hours = Math.floor(ms / (1000 * 60 * 60));
//       const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
//       return `${hours}:${minutes.toString().padStart(2, "0")}`;
//     }

//     res.json({
//       totalEmployees: totalEmployees.size,
//       avgLoginTime: msToTime(avgLoginMs),
//       avgLogoutTime: msToTime(avgLogoutMs),
//       avgWorkHours: avgWorkHours.toFixed(1)
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.get("/dashboard-stats", async (req, res) => {
//   try {
//     const { year, months } = req.query;

//     const monthNameToNumber = {
//       Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
//       Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
//     };

//     const monthArray = months
//       ? months.split(",").map(m => monthNameToNumber[m.trim()]).filter(Boolean)
//       : null;

//     // Build match conditions
//     const match = {};
//     if (year) match.dateObjYear = parseInt(year);
//     if (monthArray) match.dateObjMonth = { $in: monthArray };

//     // Helper function for time-to-ms conversion in aggregation
//     const timeToMs = (field) => ({
//       $let: {
//         vars: { parts: { $split: [`$${field}`, ":"] } },
//         in: {
//           $add: [
//             { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
//             { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
//             { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
//           ]
//         }
//       }
//     });

//     const result = await attendanceCollection.aggregate([
//       {
//         $addFields: {
//           dateObj: { $dateFromString: { dateString: "$date" } },
//         }
//       },
//       {
//         $addFields: {
//           loginMs: timeToMs("loginTime"),
//           logoutMs: timeToMs("logoutTime"),
//           dateObjYear: { $year: "$dateObj" },
//           dateObjMonth: { $month: "$dateObj" }
//         }
//       },
//       { $match: match },
//       {
//         $group: {
//           _id: null,
//           totalEmployees: { $addToSet: "$employee" },
//           totalWorkMs: { $sum: { $subtract: ["$logoutMs", "$loginMs"] } },
//           totalLoginMs: { $sum: "$loginMs" },
//           totalLogoutMs: { $sum: "$logoutMs" },
//           count: { $sum: 1 }
//         }
//       },
//       {
//         $project: {
//           totalEmployees: { $size: "$totalEmployees" },
//           avgLoginMs: { $divide: ["$totalLoginMs", "$count"] },
//           avgLogoutMs: { $divide: ["$totalLogoutMs", "$count"] },
//          avgWorkHours: { 
//   $divide: [
//     { $divide: ["$totalWorkMs", 1000 * 60 * 60] }, // convert to hours
//     "$count"                                       // divide by number of records
//   ]
// } // avg per record
//         }
//       }
//     ]).toArray();

//     const stats = result[0] || { totalEmployees: 0, avgLoginMs: 0, avgLogoutMs: 0, avgWorkHours: 0 };

//     const msToTime = (ms) => {
//       const hours = Math.floor(ms / 3600000);
//       const minutes = Math.floor((ms % 3600000) / 60000);
//       return `${hours}:${minutes.toString().padStart(2, "0")}`;
//     };

//     res.json({
//       totalEmployees: stats.totalEmployees,
//       avgLoginTime: msToTime(stats.avgLoginMs),
//       avgLogoutTime: msToTime(stats.avgLogoutMs),
//       avgWorkHours: stats.avgWorkHours.toFixed(1)
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
app.get("/dashboard-stats", async (req, res) => {
  try {
    // Build the $match stage dynamically
    const matchStage = buildMatchStage(req.query);

    const result = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: {
            $let: {
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          },
          logoutMs: {
            $let: {
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          }
        }
      },
      // Only include $match if matchStage is not null
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: null,
          totalEmployees: { $addToSet: "$employee" },
          totalWorkMs: { $sum: { $subtract: ["$logoutMs", "$loginMs"] } },
          totalLoginMs: { $sum: "$loginMs" },
          totalLogoutMs: { $sum: "$logoutMs" },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          totalEmployees: { $size: "$totalEmployees" },
          avgLoginMs: { $divide: ["$totalLoginMs", "$count"] },
          avgLogoutMs: { $divide: ["$totalLogoutMs", "$count"] },
          avgWorkHours: { $divide: [{ $divide: ["$totalWorkMs", 1000 * 60 * 60] }, "$count"] }
        }
      }
    ]).toArray();

    const stats = result[0] || { totalEmployees: 0, avgLoginMs: 0, avgLogoutMs: 0, avgWorkHours: 0 };

    const msToTime = (ms) => {
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      return `${hours}:${minutes.toString().padStart(2, "0")}`;
    };

    res.json({
      totalEmployees: stats.totalEmployees,
      avgLoginTime: msToTime(stats.avgLoginMs),
      avgLogoutTime: msToTime(stats.avgLogoutMs),
      avgWorkHours: stats.avgWorkHours.toFixed(1)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// app.get('/employee-monthly-hours', async (req, res) => {
//   try {
//     // Fetch all rows
//     const rows = await attendanceCollection.find().toArray();

//     const { year, months } = req.query;

//     const monthNameToNumber = {
//       Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
//       Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
//     };

//     // Build filter array
//     const monthArray = months
//       ? months.split(",").map(m => monthNameToNumber[m.trim()]).filter(Boolean)
//       : null;

//     const grouped = {};

//     rows.forEach((row) => {
//       if (!row.employee || !row.date || !row.loginTime || !row.logoutTime) return;

//       const d = new Date(row.date);
//       const rowYear = d.getFullYear();
//       const rowMonth = d.getMonth() + 1;

//       // Apply year/month filter
//       if (year && rowYear !== parseInt(year)) return;
//       if (monthArray && !monthArray.includes(rowMonth)) return;

//       const loginMs = parseTimeToMs(row.loginTime);
//       const logoutMs = parseTimeToMs(row.logoutTime);

//       const key = `${row.employee}-${rowYear}-${rowMonth}`;

//       if (!grouped[key]) grouped[key] = { employee: row.employee, year: rowYear, month: rowMonth, totalMs: 0 };

//       grouped[key].totalMs += logoutMs - loginMs;
//     });

//     const monthlyHours = Object.values(grouped)
//       .map(item => ({
//         employee: item.employee,
//         year: item.year,
//         month: item.month,
//         totalWorkHours: +(item.totalMs / 1000 / 60 / 60).toFixed(2)
//       }))
//       .sort((a, b) =>
//         a.employee.localeCompare(b.employee) || a.year - b.year || a.month - b.month
//       );

//     res.json(monthlyHours);

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// app.get("/monthly-overtime", async (req, res) => {
//   try {
//     const rows = await attendanceCollection.find().toArray();
//     const { year, months } = req.query;

//     const monthNameToNumber = {
//       Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
//       Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
//     };

//     const monthArray = months
//       ? months.split(",").map(m => monthNameToNumber[m.trim()]).filter(Boolean)
//       : null;

//     const monthOvertime = {};

//     rows.forEach(row => {
//       if (!row.loginTime || !row.logoutTime || !row.date) return;

//       const date = new Date(row.date);
//       const rowYear = date.getFullYear();
//       const rowMonth = date.getMonth() + 1;

//       // Apply filters
//       if (year && rowYear !== parseInt(year)) return;
//       if (monthArray && !monthArray.includes(rowMonth)) return;

//       // Calculate worked hours
//       const workedHours = (parseTimeToMs(row.logoutTime) - parseTimeToMs(row.loginTime)) / (1000 * 60 * 60);

//       // Overtime = hours beyond 8
//       const overtime = workedHours > 8 ? workedHours - 8 : 0;

//       if (!monthOvertime[rowMonth]) monthOvertime[rowMonth] = 0;
//       monthOvertime[rowMonth] += overtime;
//     });

//     const result = Object.entries(monthOvertime)
//       .sort(([a], [b]) => a - b)
//       .map(([month, totalOvertime]) => ({
//         month: +month,
//         totalOvertime: +totalOvertime.toFixed(2)
//       }));

//     res.json(result);

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

app.get('/employee-monthly-hours', async (req, res) => {
  try {
    const matchStage = buildMatchStage(req.query);

    const result = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: {
            $let: {
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          },
          logoutMs: {
            $let: {
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          }
        }
      },
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: { employee: "$employee", year: { $year: "$dateObj" }, month: { $month: "$dateObj" } },
          totalWorkMs: { $sum: { $subtract: ["$logoutMs", "$loginMs"] } }
        }
      },
      {
        $project: {
          _id: 0,
          employee: "$_id.employee",
          year: "$_id.year",
          month: "$_id.month",
          totalWorkHours: { $divide: ["$totalWorkMs", 1000 * 60 * 60] } // convert to hours
        }
      },
      { $sort: { employee: 1, year: 1, month: 1 } }
    ]).toArray();

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/monthly-overtime", async (req, res) => {
  try {
    const matchStage = buildMatchStage(req.query);

    const result = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: {
            $let: {
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          },
          logoutMs: {
            $let: {
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          }
        }
      },
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: { month: { $month: "$dateObj" } },
          totalOvertimeMs: {
            $sum: {
              $cond: [
                { $gt: [{ $subtract: ["$logoutMs", "$loginMs"] }, 8 * 3600000] },
                { $subtract: [{ $subtract: ["$logoutMs", "$loginMs"] }, 8 * 3600000] },
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          month: "$_id.month",
         totalOvertime: { 
        $round: [{ $divide: ["$totalOvertimeMs", 1000 * 60 * 60] }] 
         } // convert ms → hours
        }
      },
      { $sort: { month: 1 } }
    ]).toArray();

    res.json(result);

  } catch (err) {
    console.error(err); // log the error to see the exact reason
    res.status(500).json({ error: err.message });
  }
});


app.get("/avg-break-per-month", async (req, res) => {
  try {
    const matchStage = buildMatchStage(req.query);

    const result = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: { 
            $let: { 
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: { $add: [
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
              ]}
            }
          },
          logoutMs: { 
            $let: { 
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: { $add: [
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
              ]}
            }
          }
        }
      },
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: { month: { $month: "$dateObj" } },
          totalBreakMs: { 
            $sum: { 
              $cond: [
                { $gt: [{ $subtract: ["$logoutMs", "$loginMs"] }, 8 * 3600000] },
                { $subtract: [{ $subtract: ["$logoutMs", "$loginMs"] }, 8 * 3600000] },
                0
              ]
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          month: "$_id.month",
          avgBreakHours: { $divide: ["$totalBreakMs", { $multiply: ["$count", 1000 * 60 * 60] }] }
        }
      },
      { $sort: { month: 1 } }
    ]).toArray();

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



app.get("/total-break-per-month", async (req, res) => {
  try {
    const matchStage = buildMatchStage(req.query);

    const result = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: { 
            $let: { 
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: { $add: [
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
              ]}
            }
          },
          logoutMs: { 
            $let: { 
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: { $add: [
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
              ]}
            }
          }
        }
      },
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: { month: { $month: "$dateObj" } },
          totalBreakMs: { 
            $sum: { 
              $cond: [
                { $gt: [{ $subtract: ["$logoutMs", "$loginMs"] }, 8 * 3600000] },
                { $subtract: [{ $subtract: ["$logoutMs", "$loginMs"] }, 8 * 3600000] },
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          month: "$_id.month",
          totalBreakHours: { $divide: ["$totalBreakMs", 1000 * 60 * 60] }
        }
      },
      { $sort: { month: 1 } }
    ]).toArray();

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



app.get("/top-working-hours", async (req, res) => {
  try {
    const matchStage = buildMatchStage(req.query);

    const result = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: {
            $let: {
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          },
          logoutMs: {
            $let: {
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          }
        }
      },
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: "$employee",
          totalMs: { $sum: { $subtract: ["$logoutMs", "$loginMs"] } }
        }
      },
      {
        $project: {
          _id: 0,
          employee: "$_id",
          totalHours: { $divide: ["$totalMs", 1000 * 60 * 60] }
        }
      },
      { $sort: { totalHours: -1 } },
      { $limit: 5 }
    ]).toArray();

    res.json(result.map(r => ({ employee: r.employee, totalHours: +r.totalHours.toFixed(2) })));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/bottom-working-hours", async (req, res) => {
  try {
    const matchStage = buildMatchStage(req.query);

    const result = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: {
            $let: {
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          },
          logoutMs: {
            $let: {
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          }
        }
      },
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: "$employee",
          totalMs: { $sum: { $subtract: ["$logoutMs", "$loginMs"] } }
        }
      },
      {
        $project: {
          _id: 0,
          employee: "$_id",
          totalHours: { $divide: ["$totalMs", 1000 * 60 * 60] }
        }
      },
      { $sort: { totalHours: 1 } },
      { $limit: 5 }
    ]).toArray();

    res.json(result.map(r => ({ employee: r.employee, totalHours: +r.totalHours.toFixed(2) })));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


app.get("/employee-summary", async (req, res) => {
  try {
    const matchStage = buildMatchStage(req.query);

    const summary = await attendanceCollection.aggregate([
      {
        $addFields: {
          dateObj: { $dateFromString: { dateString: "$date" } },
          loginMs: {
            $let: {
              vars: { parts: { $split: ["$loginTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          },
          logoutMs: {
            $let: {
              vars: { parts: { $split: ["$logoutTime", ":"] } },
              in: {
                $add: [
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 3600000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60000] },
                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 1000] }
                ]
              }
            }
          }
        }
      },
      ...(matchStage ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: "$employee",
          totalMs: { $sum: { $subtract: ["$logoutMs", "$loginMs"] } },
          maxMs: { $max: { $subtract: ["$logoutMs", "$loginMs"] } },
          minMs: { $min: { $subtract: ["$logoutMs", "$loginMs"] } },
          daysWorked: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          employee: "$_id",
          totalHours: { $divide: ["$totalMs", 1000 * 60 * 60] },
          avgHours: { $divide: ["$totalMs", { $multiply: ["$daysWorked", 1000 * 60 * 60] }] },
          maxHours: { $divide: ["$maxMs", 1000 * 60 * 60] },
          minHours: { $divide: ["$minMs", 1000 * 60 * 60] },
          daysWorked: 1
        }
      },
      { $sort: { totalHours: -1 } }
    ]).toArray();

    // Round values
    const rounded = summary.map(emp => ({
      employee: emp.employee,
      totalHours: +emp.totalHours.toFixed(2),
      avgHours: +emp.avgHours.toFixed(2),
      maxHours: +emp.maxHours.toFixed(2),
      minHours: +emp.minHours.toFixed(2),
      daysWorked: emp.daysWorked
    }));

    res.json(rounded);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/attendance-years", async (req, res) => {
  try {
    const years = await attendanceCollection.aggregate([
      {
        $project: {
          year: { $year: { $dateFromString: { dateString: "$date" } } }
        }
      },
      { $group: { _id: "$year" } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, year: "$_id" } }
    ]).toArray();

    res.json(years.map(y => y.year));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});





// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

