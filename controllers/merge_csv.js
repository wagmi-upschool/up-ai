import fs from "fs";
import path from "path";

const mergeCSVFiles = async () => {
  try {
    // Get the exports directory path
    const exportDir = path.join(process.cwd(), "exports");

    // Read all files in the exports directory
    const files = fs
      .readdirSync(exportDir)
      .filter((file) => file.endsWith(".csv"));

    if (files.length === 0) {
      console.log("No CSV files found in exports directory");
      return;
    }

    console.log(`Found ${files.length} CSV files to merge`);

    // Read the first file to get the header
    const firstFile = fs.readFileSync(path.join(exportDir, files[0]), "utf-8");
    const header = firstFile.split("\n")[0];

    // Initialize merged content with header
    let mergedContent = [header];

    // Process each file
    for (const file of files) {
      console.log(`Processing file: ${file}`);
      const content = fs.readFileSync(path.join(exportDir, file), "utf-8");

      // Split content into lines and remove header
      const lines = content.split("\n").slice(1);

      // Add non-empty lines to merged content
      for (const line of lines) {
        if (line.trim()) {
          mergedContent.push(line);
        }
      }
    }

    // Create output filename with timestamp
    const timestamp = new Date().toISOString().split("T")[0];
    const outputFile = path.join(
      exportDir,
      `merged_conversations_${timestamp}.csv`
    );

    // Write merged content to file
    fs.writeFileSync(outputFile, mergedContent.join("\n"));

    console.log(
      `Successfully merged ${files.length} files into: ${outputFile}`
    );
    console.log(`Total rows in merged file: ${mergedContent.length}`);

    return outputFile;
  } catch (error) {
    console.error("Error merging CSV files:", error);
    throw error;
  }
};

// Run if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  mergeCSVFiles().catch(console.error);
}

export { mergeCSVFiles };
