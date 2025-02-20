import fs from "fs";
import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";

// Input and output file paths
const inputFile = "./exports/cognito_users.csv";
const outputFile = "./exports/sorted_cognito_users.csv";

// Read and process the CSV file
const results = [];
fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (data) => results.push(data))
  .on("end", () => {
    // Sort by createdDate in descending order (newest first)
    results.sort((a, b) => {
      // Ensure dates are in YYYY-MM-DD format and compare them
      const dateA = a.createdDate;
      const dateB = b.createdDate;
      if (dateA > dateB) return -1; // newer dates first
      if (dateA < dateB) return 1; // older dates later
      return 0;
    });

    // Write the sorted data to a new CSV file
    const csvWriter = createObjectCsvWriter({
      path: outputFile,
      header: [
        { id: "email", title: "email" },
        { id: "username", title: "username" },
        { id: "status", title: "status" },
        { id: "createdDate", title: "createdDate" },
        { id: "lastModified", title: "lastModified" },
      ],
    });

    csvWriter
      .writeRecords(results)
      .then(() => {
        console.log(`Successfully sorted and saved to ${outputFile}`);
        console.log(`Total users processed: ${results.length}`);

        // Print newest 20 records with just date and email
        console.log("\nNewest 20 records:");
        console.log("----------------------------------------");
        results.slice(0, 20).forEach((record, index) => {
          console.log(`${index + 1}. ${record.createdDate} | ${record.email}`);
        });
        console.log("----------------------------------------");
      })
      .catch((err) => {
        console.error("Error writing CSV file:", err);
      });
  })
  .on("error", (err) => {
    console.error("Error reading CSV file:", err);
  });
