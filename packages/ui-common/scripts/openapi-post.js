import fs from "fs";
import path from "path";

const outputDir = "./src/api"; // Replace with your output directory
const tsNoCheckDirectory = "./src/api/src/"; // Replace with your directory
const tsIgnorePragma = "// @ts-nocheck\n";
const distDir = path.join(outputDir, "dist");
const packageJsonPath = path.join(outputDir, "package.json");

// Function to recursively delete a directory
function deleteDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const filePath = path.join(dirPath, file);
      if (fs.lstatSync(filePath).isDirectory()) {
        deleteDirectory(filePath); // Recursively delete subdirectories
      } else {
        fs.unlinkSync(filePath); // Delete files
      }
    });
    fs.rmdirSync(dirPath); // Delete the directory itself
    console.log(`Deleted directory: ${dirPath}`);
  }
}

// Delete the dist directory
deleteDirectory(distDir);

// Modify package.json
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.main = "./src/index.ts";
  packageJson.module = "./src/index.ts";
  delete packageJson.types;
  delete packageJson.typings;
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2),
    "utf8"
  );
  console.log(`Updated "main" field from ${packageJsonPath}`);
}

function processFiles(directory) {
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error("Error reading directory:", err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(directory, file);

      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error("Error getting file stats:", err);
          return;
        }

        if (stats.isDirectory()) {
          // If it's a directory, recursively process it
          processFiles(filePath);
        } else if (filePath.endsWith(".ts")) {
          // If it's a .ts file, add the pragma
          fs.readFile(filePath, "utf8", (err, data) => {
            if (err) {
              console.error("Error reading file:", err);
              return;
            }

            // Add the pragma at the beginning
            const newData = tsIgnorePragma + data;

            fs.writeFile(filePath, newData, "utf8", (err) => {
              if (err) {
                console.error("Error writing file:", err);
                return;
              }
              console.log(`Added @ts-nocheck to ${filePath}`);
            });
          });
        }
      });
    });
  });
}

processFiles(tsNoCheckDirectory);
