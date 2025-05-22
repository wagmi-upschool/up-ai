import AWS from "aws-sdk";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configure AWS SDK
const configureAWS = (region = "us-east-1") => {
  AWS.config.update({ region });
  return new AWS.CognitoIdentityServiceProvider();
};

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function for exponential backoff
const getBackoffDelay = (attempt, baseDelay = 1000, maxDelay = 30000) => {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * 100; // Add some randomness
  return exponentialDelay + jitter;
};

const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000; // For retrying a failed call
const INTER_SUCCESSFUL_BATCH_DELAY_MS = 500; // Delay between successful paginated calls
const USERS_BATCH_LIMIT = 50; // Cognito ListUsers limit is max 60

// Get all users from Cognito User Pool
const getAllUsers = async (cognito, userPoolId) => {
  const allFetchedUsers = [];
  let currentPaginationToken = null;
  let firstBatchProcessed = false;

  console.log(`Starting to fetch all users for User Pool ID: ${userPoolId}`);

  do {
    if (firstBatchProcessed && currentPaginationToken) {
      // Delay between successfully fetched batches (after the first one if more are coming)
      console.log(
        `Waiting ${INTER_SUCCESSFUL_BATCH_DELAY_MS}ms before fetching next batch of users...`
      );
      await delay(INTER_SUCCESSFUL_BATCH_DELAY_MS);
    }

    const requestParams = {
      UserPoolId: userPoolId,
      Limit: USERS_BATCH_LIMIT,
      ...(currentPaginationToken && {
        PaginationToken: currentPaginationToken,
      }),
    };

    let currentAttempt = 0;
    let batchFetchedSuccessfully = false;
    let batchResponse = null;

    while (currentAttempt < MAX_RETRY_ATTEMPTS && !batchFetchedSuccessfully) {
      try {
        console.log(
          `Attempt ${
            currentAttempt + 1
          }/${MAX_RETRY_ATTEMPTS} to fetch user batch. Params: ${JSON.stringify(
            requestParams
          )}`
        );
        batchResponse = await cognito.listUsers(requestParams).promise();
        batchFetchedSuccessfully = true;
      } catch (error) {
        currentAttempt++;
        if (
          error.name === "TooManyRequestsException" &&
          currentAttempt < MAX_RETRY_ATTEMPTS
        ) {
          const retryDelayTime = getBackoffDelay(
            currentAttempt,
            BASE_RETRY_DELAY_MS
          );
          console.warn(
            `TooManyRequestsException for ListUsers. Attempt ${currentAttempt}. Retrying in ${retryDelayTime}ms...`
          );
          await delay(retryDelayTime);
        } else {
          console.error(
            `Failed to fetch user batch after ${currentAttempt} attempts or due to an unrecoverable error:`,
            error
          );
          throw error; // Rethrow if max attempts reached or other error
        }
      }
    }

    if (!batchFetchedSuccessfully || !batchResponse) {
      console.error(
        `Critical error: User batch fetching loop completed without success for params: ${JSON.stringify(
          requestParams
        )}`
      );
      throw new Error("Failed to fetch a user batch after multiple retries.");
    }

    if (batchResponse.Users && batchResponse.Users.length > 0) {
      allFetchedUsers.push(...batchResponse.Users);
      console.log(
        `Fetched ${batchResponse.Users.length} users in this batch. Total users so far: ${allFetchedUsers.length}.`
      );
    } else {
      console.log(
        "No users found in this batch (or an empty page was returned)."
      );
    }
    currentPaginationToken = batchResponse.PaginationToken;
    firstBatchProcessed = true; // Mark that at least one batch attempt (successful or not for content) has been made
  } while (currentPaginationToken);

  console.log(`Finished fetching all users. Total: ${allFetchedUsers.length}`);
  return allFetchedUsers;
};

const generateUserGroupNotificationReport = async (
  userPoolId,
  filterByGroupName = null
) => {
  try {
    console.log(
      `\nInitializing user notification status report for Pool ID: ${userPoolId}`
    );
    if (filterByGroupName) {
      console.log(
        `Filtering for users with custom:groupName attribute = '${filterByGroupName}'`
      );
      console.log(
        `NOTE: Using user attribute custom:groupName instead of Cognito groups`
      );
    } else {
      console.log(`Generating general report for all users.`);
    }

    const cognito = configureAWS();
    console.log("Starting user fetch process...");
    const allUsers = await getAllUsers(cognito, userPoolId);
    console.log(`\nFetched ${allUsers.length} total users from Cognito pool.`);
    console.log("Now beginning user detail processing for report...");

    const DETAIL_BATCH_SIZE = 25; // Process user details in batches
    const userDataForCsv = [];
    let totalTrueStatusInCsv = 0;
    let totalFalseStatusInCsv = 0;
    let totalNotSetStatusInCsv = 0;
    let usersMatchingCriteriaCount = 0;
    let processedCount = 0;

    // Process users in batches
    for (let i = 0; i < allUsers.length; i += DETAIL_BATCH_SIZE) {
      const userBatch = allUsers.slice(i, i + DETAIL_BATCH_SIZE);
      console.log(
        `\nProcessing batch ${
          Math.floor(i / DETAIL_BATCH_SIZE) + 1
        } of ${Math.ceil(allUsers.length / DETAIL_BATCH_SIZE)} (${
          userBatch.length
        } users)`
      );

      // Process each user in the current batch
      for (const basicUser of userBatch) {
        processedCount++;

        if (!basicUser.Username) {
          console.warn(
            `Skipping user with missing Username at index ${
              i + userBatch.indexOf(basicUser)
            }`
          );
          continue;
        }

        // Add inter-user small delay to prevent hitting API limits
        if (userBatch.indexOf(basicUser) > 0) {
          await delay(100); // Small delay between processing each user in a batch
        }

        let userEmail = null;
        let notificationStatusValue = null;
        let userGroupName = null;
        let userQualifiesForReport = false;

        // Get user attributes directly from the user object or via API call if needed
        try {
          let attributesAttempt = 0;
          let attributesFetched = false;
          const userDetailsParams = {
            UserPoolId: userPoolId,
            Username: basicUser.Username,
          };

          // First try to get attributes from the user object if they're already included
          if (basicUser.Attributes && Array.isArray(basicUser.Attributes)) {
            attributesFetched = true;
            processUserAttributes(basicUser.Attributes);
            console.log(
              `Found attributes in the user object for ${basicUser.Username}`
            );
          }
          // If not available in the basic user object, fetch details via API
          else {
            console.log(`Fetching attributes for user ${basicUser.Username}`);

            while (
              !attributesFetched &&
              attributesAttempt < MAX_RETRY_ATTEMPTS
            ) {
              try {
                const userDetailsResponse = await cognito
                  .adminGetUser(userDetailsParams)
                  .promise();
                attributesFetched = true;

                if (
                  userDetailsResponse.UserAttributes &&
                  Array.isArray(userDetailsResponse.UserAttributes)
                ) {
                  processUserAttributes(userDetailsResponse.UserAttributes);
                } else {
                  console.log(
                    `→ No UserAttributes found for ${basicUser.Username}`
                  );
                }
              } catch (detailsError) {
                attributesAttempt++;
                if (
                  detailsError.name === "TooManyRequestsException" &&
                  attributesAttempt < MAX_RETRY_ATTEMPTS
                ) {
                  const retryDelayTime = getBackoffDelay(
                    attributesAttempt,
                    BASE_RETRY_DELAY_MS
                  );
                  console.warn(
                    `Rate-limit hit when fetching attributes for ${basicUser.Username}. Retry ${attributesAttempt} in ${retryDelayTime}ms...`
                  );
                  await delay(retryDelayTime);
                } else {
                  console.warn(
                    `Failed to fetch details for user ${basicUser.Username} after ${attributesAttempt} attempts:`,
                    detailsError.message
                  );
                  break;
                }
              }
            }
          }

          // Helper function to process attributes consistently
          function processUserAttributes(attributes) {
            let foundEmail = false;
            let foundNotificationStatus = false;
            let foundGroupName = false;

            attributes.forEach((attr) => {
              // Check for email attribute
              if (attr.Name === "email") {
                userEmail = attr.Value;
                foundEmail = true;
                console.log(
                  `→ Found email for ${basicUser.Username}: ${attr.Value}`
                );
              }

              // Check for notification status attribute
              if (attr.Name === "custom:notification_status") {
                foundNotificationStatus = true;
                if (attr.Value === "true") {
                  notificationStatusValue = true;
                  console.log(
                    `→ Notification status for ${basicUser.Username}: true`
                  );
                } else if (attr.Value === "false") {
                  notificationStatusValue = false;
                  console.log(
                    `→ Notification status for ${basicUser.Username}: false (will be included in CSV)`
                  );
                } else {
                  console.log(
                    `→ Notification status for ${basicUser.Username} has unexpected value: '${attr.Value}'`
                  );
                }
              }

              // Check for group name attribute
              if (attr.Name === "custom:groupName") {
                userGroupName = attr.Value;
                foundGroupName = true;
                console.log(
                  `→ Found group attribute for ${basicUser.Username}: '${attr.Value}'`
                );

                // Check if this user qualifies based on the group name filter
                if (filterByGroupName) {
                  if (
                    attr.Value &&
                    attr.Value.toLowerCase() === filterByGroupName.toLowerCase()
                  ) {
                    userQualifiesForReport = true;
                    console.log(
                      `→ User ${basicUser.Username} MATCHES target group '${filterByGroupName}'`
                    );
                  } else {
                    console.log(
                      `→ User ${basicUser.Username} has group '${attr.Value}', NOT matching target '${filterByGroupName}'`
                    );
                  }
                } else {
                  // No filtering, all users qualify
                  userQualifiesForReport = foundEmail;
                }
              }
            });

            // If no groupName filter specified, all users with email qualify
            if (!filterByGroupName) {
              userQualifiesForReport = foundEmail;
            }

            // Log warnings for missing attributes
            if (!foundEmail) {
              console.log(
                `→ Warning: No email attribute found for ${basicUser.Username}`
              );
            }
            if (!foundNotificationStatus) {
              console.log(
                `→ Warning: No custom:notification_status attribute found for ${basicUser.Username}`
              );
            }
            if (!foundGroupName) {
              console.log(
                `→ Warning: No custom:groupName attribute found for ${basicUser.Username}`
              );
              if (filterByGroupName) {
                console.log(
                  `→ User ${basicUser.Username} does not have a group attribute, not included in filtered report.`
                );
              }
            }
          }
        } catch (error) {
          console.error(
            `Unexpected error processing attributes for user ${basicUser.Username}:`,
            error.message
          );
          continue; // Skip to next user on unexpected error
        }

        // Skip users that don't qualify for the report based on our criteria
        if (!userQualifiesForReport) {
          console.log(
            `User ${basicUser.Username} does not qualify for the report - skipping.`
          );
          continue;
        }

        // If email is missing, log and skip
        if (!userEmail) {
          console.warn(
            `User ${basicUser.Username} qualifies but has no email attribute. Not adding to CSV.`
          );
          continue; // Skip users without email
        }

        // At this point, user qualifies and has an email
        usersMatchingCriteriaCount++;

        // Update notification counts
        if (notificationStatusValue === true) totalTrueStatusInCsv++;
        else if (notificationStatusValue === false) totalFalseStatusInCsv++;
        else totalNotSetStatusInCsv++;

        // Add to CSV data
        userDataForCsv.push({
          userGroup: userGroupName || "N/A",
          email: userEmail,
          notificationStatus: notificationStatusValue,
        });

        // Progress update every 10 users
        if (processedCount % 10 === 0 || processedCount === allUsers.length) {
          console.log(
            `Processed ${processedCount}/${allUsers.length} users (${Math.round(
              (processedCount / allUsers.length) * 100
            )}%). Found ${usersMatchingCriteriaCount} matching report criteria.`
          );
        }
      }

      // Add delay between batches if not the last batch
      if (i + DETAIL_BATCH_SIZE < allUsers.length) {
        console.log(
          `Completed batch ${
            Math.floor(i / DETAIL_BATCH_SIZE) + 1
          }. Waiting before processing next batch...`
        );
        await delay(INTER_SUCCESSFUL_BATCH_DELAY_MS);
      }
    }

    console.log(`\nCompleted processing all ${allUsers.length} users.`);

    // Generate CSV
    let csvOutput = "Usergroup,Email,Notification Status\n";
    userDataForCsv.forEach((userEntry) => {
      csvOutput += `${userEntry.userGroup},${userEntry.email},${
        userEntry.notificationStatus === null
          ? ""
          : userEntry.notificationStatus
      }\n`;
    });

    // Print analysis results
    console.log("\nUser Group Notification Status Report Results:");
    console.log("-------------------------------------------------------");
    if (filterByGroupName) {
      console.log(`Filtered for custom:groupName = '${filterByGroupName}'`);
    }
    console.log(`Total Cognito Users Scanned: ${allUsers.length}`);
    console.log(
      `Users with email matching criteria for CSV: ${usersMatchingCriteriaCount}`
    );
    console.log(`Total rows in CSV: ${userDataForCsv.length}`);
    console.log("Notification Status Counts (ALL included in CSV output):");
    console.log(`  True: ${totalTrueStatusInCsv}`);
    console.log(`  False: ${totalFalseStatusInCsv} (explicitly included)`);
    console.log(`  Not Set: ${totalNotSetStatusInCsv}`);

    console.log("\nCSV Output Preview:");
    const previewLines = csvOutput
      .split("\n")
      .slice(0, Math.min(6, userDataForCsv.length + 1))
      .join("\n");
    console.log(
      previewLines + (userDataForCsv.length > 5 ? "\n... and more rows" : "")
    );

    return {
      counts: {
        trueInCsv: totalTrueStatusInCsv,
        falseInCsv: totalFalseStatusInCsv,
        notSetInCsv: totalNotSetStatusInCsv,
        usersInCsv: usersMatchingCriteriaCount,
        totalCsvRows: userDataForCsv.length,
        totalCognitoUsersScanned: allUsers.length,
      },
      csv: csvOutput,
      reportData: userDataForCsv,
    };
  } catch (error) {
    console.error(
      "\nError generating user group notification report:",
      error.message
    );
    if (error.code === "AccessDeniedException") {
      console.error("Access Denied. Please check your AWS IAM permissions.");
      console.error(
        "Required permissions: cognito-idp:ListUsers, cognito-idp:AdminGetUser"
      );
    } else if (error.code === "ResourceNotFoundException") {
      console.error(
        "A resource (e.g., User Pool) was not found. Please check your POOL_ID."
      );
    }
  }
};

// Main function
async function main() {
  // Hard-coded pool ID - should match your Cognito User Pool
  const poolId = "us-east-1_tTejiiLwi"; //process.env.POOL_ID;
  console.log("Using Cognito User Pool ID:", poolId);

  // Hard-coded target group name (must exactly match the groupName attribute value)
  const targetGroupNameForReport = "isbank"; // Explicitly set for this request
  console.log(
    "Filtering for users with custom:groupName attribute =",
    targetGroupNameForReport
  );

  // Check for common AWS SDK setup issues
  const region = process.env.AWS_REGION || "us-east-1";
  console.log(`AWS Region setting: ${region}`);

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn(
      "WARNING: AWS credentials environment variables not detected."
    );
    console.warn("Make sure your AWS credentials are properly configured via:");
    console.warn(
      "- Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)"
    );
    console.warn("- Shared credentials file (~/.aws/credentials)");
    console.warn(
      "- EC2 instance role / container role if running on AWS infrastructure"
    );
  }

  if (!poolId) {
    console.error(
      "Error: User Pool ID (POOL_ID) is not set. Cannot proceed without a valid Cognito User Pool ID."
    );
    process.exit(1);
  }

  try {
    console.log("\nStarting report generation...");
    // Pass the target group name to the reporting function
    const results = await generateUserGroupNotificationReport(
      poolId,
      targetGroupNameForReport
    );

    if (!results) {
      console.error(
        "\nReport generation did not complete successfully due to errors reported above."
      );
      process.exit(1);
    }

    // Summary output with clear statistics
    console.log("\n----- REPORT SUMMARY -----");
    console.log(
      `Total users found in Cognito: ${results.counts.totalCognitoUsersScanned}`
    );
    console.log(
      `Users with custom:groupName = '${targetGroupNameForReport}': ${results.counts.usersInCsv}`
    );
    console.log(`  With notification status TRUE: ${results.counts.trueInCsv}`);
    console.log(
      `  With notification status FALSE: ${results.counts.falseInCsv} (included in CSV)`
    );
    console.log(
      `  With notification status NOT SET: ${results.counts.notSetInCsv}`
    );
    console.log(`Total rows in CSV: ${results.counts.totalCsvRows}`);

    // Output first few CSV rows as preview
    if (results.reportData && results.reportData.length > 0) {
      console.log("\nFirst 5 CSV entries (preview):");
      results.reportData.slice(0, 5).forEach((entry, idx) => {
        const statusDisplay =
          entry.notificationStatus === false
            ? `${entry.notificationStatus} (explicitly included)`
            : entry.notificationStatus;
        console.log(
          `${idx + 1}. Group: ${entry.userGroup}, Email: ${
            entry.email
          }, Notification: ${statusDisplay}`
        );
      });
    } else {
      console.log("\nWARNING: No user data was found matching the criteria!");
      console.log(`This suggests either:`);
      console.log(
        `1. No users exist with custom:groupName = '${targetGroupNameForReport}'`
      );
      console.log(
        `2. Users exist with the attribute but have no email attribute`
      );
      console.log(
        `3. Attribute name/value case mismatch (check for exact casing)`
      );
      console.log(`4. Permission issues with Cognito API calls`);
      console.log(
        `5. 'custom:notification_status' attribute may be named differently`
      );
    }

    // Write the CSV to a file
    try {
      const fs = await import("fs");
      const path = await import("path");

      const timestamp = new Date().toISOString().split("T")[0];
      const fileName = `${targetGroupNameForReport}_notifications_${timestamp}.csv`;
      const outputFile = path.join(process.cwd(), fileName);

      fs.writeFileSync(outputFile, results.csv);
      console.log(`\nCSV data written to: ${outputFile}`);

      // Additionally, log all the emails found to a separate file for easier reference
      if (results.reportData && results.reportData.length > 0) {
        const emailsOnly = results.reportData.map((user) => user.email).sort();
        const uniqueEmails = [...new Set(emailsOnly)]; // Remove duplicates
        const emailsFile = `${targetGroupNameForReport}_emails_${timestamp}.txt`;
        const emailsFilePath = path.join(process.cwd(), emailsFile);

        fs.writeFileSync(emailsFilePath, uniqueEmails.join("\n"));
        console.log(
          `Email-only list written to: ${emailsFilePath} (${uniqueEmails.length} unique emails)`
        );
      } else if (results.reportData && results.reportData.length === 0) {
        console.log(
          "NOTE: The CSV file contains only the header row since no matching data was found."
        );
      }
    } catch (fileError) {
      console.error("\nFailed to write output files:", fileError.message);
      console.log("CSV output is still available in the console above.");
    }
  } catch (error) {
    console.error(
      "\nMain function encountered an unhandled error:",
      error.message,
      error.stack
    );
    process.exit(1);
  }
}

// Run the analysis if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("\nCritical error during script execution:", err.message);
    process.exit(1);
  });
}

export { generateUserGroupNotificationReport };
