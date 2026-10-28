'use strict';

/*
 * Admin parolini tiklash (parol esdan chiqqanda).
 * Serverda ishga tushiring:   npm run reset-admin
 * Yangi parolni oʻzingiz bermoqchi boʻlsangiz:   NEW_PASSWORD='...' npm run reset-admin
 * Barcha eski sessiyalar tugatiladi.
 */

const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const sec = require('../src/security');

(async () => {
  const config = loadConfig();
  const db = openDb(config.dbFile);
  const given = process.env.NEW_PASSWORD;
  if (given) {
    const problem = sec.passwordProblem(given);
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
  }
  const password = given || sec.generatePassword(20);
  const existing = db.getAdmin();
  const username = existing ? existing.username : config.adminUser;
  db.setAdmin(username, await sec.hashPassword(password));
  db.deleteAllSessions();
  db.close();
  console.log(`Login : ${username}`);
  console.log(given ? 'Parol : NEW_PASSWORD orqali berilgan' : `Parol : ${password}`);
  console.log('Barcha eski sessiyalar tugatildi.');
})();
