const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_URI; // Your MongoDB URI in .env
const client = new MongoClient(uri);

const employees = [
  "John Doe",
  "Jane Smith",
  "Alice Brown",
  "Bob Johnson",
  "Mary Williams"
];

// Convert date to Bangladesh timezone (UTC+6)
function toBangladeshTime(date) {
  const bdDate = new Date(date);
  const offset = 6 * 60; // BD timezone offset in minutes
  const localOffset = bdDate.getTimezoneOffset(); // local offset in minutes
  bdDate.setMinutes(bdDate.getMinutes() + localOffset + offset);
  return bdDate;
}

// Generate random login time (BD time) from 10 AM onwards
function randomLoginTime(date, startHour = 10, endHour = 11) {
  const hour = Math.floor(Math.random() * (endHour - startHour + 1)) + startHour; // 10-11 AM
  const minute = Math.floor(Math.random() * 60);
  const newDate = new Date(date);
  newDate.setHours(hour, minute, 0, 0);
  return toBangladeshTime(newDate);
}

// Generate random logout time (8-11 hours after login)
function randomLogoutTime(login) {
  const hours = Math.floor(Math.random() * 4) + 8; // 8-11 hours
  const minutes = Math.floor(Math.random() * 60);
  const logout = new Date(login);
  logout.setHours(logout.getHours() + hours);
  logout.setMinutes(logout.getMinutes() + minutes);
  return logout; // already BD time
}

// Get all dates of the year
function getAllDates(year) {
  const dates = [];
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);

  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }
  return dates;
}

// Seed function
async function seed() {
  try {
    await client.connect();
    const db = client.db('attendance');
    const sessionCollection = db.collection('userSessions');

    // Clear previous data
    await sessionCollection.deleteMany({});

    const allDates = getAllDates(2025);
    const records = [];

    employees.forEach(emp => {
      allDates.forEach(date => {
        const loginTime = randomLoginTime(date); // 10-11 AM BD
        const logoutTime = randomLogoutTime(loginTime); // 8-11 hours after login

        records.push({
          employee: emp,
          date: new Date(date),
          loginTime,
          logoutTime
        });
      });
    });

    const result = await sessionCollection.insertMany(records);
    console.log(`Inserted ${result.insertedCount} attendance records successfully!`);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

seed();
