import fs from "fs";
import csv from "@fast-csv/parse";

const analyzeUsers = async (filePath) => {
  return new Promise((resolve, reject) => {
    const stats = {
      emailUsers: 0,
      googleUsers: 0,
      appleUsers: 0,
      total: 0,
    };

    fs.createReadStream(filePath)
      .pipe(csv.parse({ headers: true }))
      .on("data", (row) => {
        stats.total++;
        if (row.username.startsWith("google_")) {
          stats.googleUsers++;
        } else if (row.username.startsWith("signinwithapple_")) {
          stats.appleUsers++;
        } else {
          stats.emailUsers++;
        }
      })
      .on("end", () => {
        console.log("\nUser Authentication Analysis:");
        console.log("----------------------------");
        console.log(`Total Users: ${stats.total}`);
        console.log(
          `Email/Password Users: ${stats.emailUsers} (${(
            (stats.emailUsers / stats.total) *
            100
          ).toFixed(2)}%)`
        );
        console.log(
          `Google Sign-in Users: ${stats.googleUsers} (${(
            (stats.googleUsers / stats.total) *
            100
          ).toFixed(2)}%)`
        );
        console.log(
          `Apple Sign-in Users: ${stats.appleUsers} (${(
            (stats.appleUsers / stats.total) *
            100
          ).toFixed(2)}%)`
        );
        resolve(stats);
      })
      .on("error", reject);
  });
};

// Run the analysis
analyzeUsers("./cognito_users.csv").catch(console.error);
