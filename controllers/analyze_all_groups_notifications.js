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
    firstBatchProcessed = true; // Mark that at least one batch attempt has been made
  } while (currentPaginationToken);

  console.log(`Finished fetching all users. Total: ${allFetchedUsers.length}`);
  return allFetchedUsers;
};

const generateAllGroupsNotificationReport = async (userPoolId) => {
  try {
    console.log(
      `\nInitializing notification status report for all groups in Pool ID: ${userPoolId}`
    );
    console.log(`Will group users by their custom:groupName attribute value`);

    const cognito = configureAWS();
    console.log("Starting user fetch process...");
    const allUsers = await getAllUsers(cognito, userPoolId);
    console.log(`\nFetched ${allUsers.length} total users from Cognito pool.`);
    console.log(
      "Now processing users to group by custom:groupName attribute..."
    );

    const DETAIL_BATCH_SIZE = 25; // Process user details in batches
    const groupedData = {
      // Will store data grouped by groupName, with this structure:
      // {
      //   "groupName1": {
      //     users: [], // Array of processed user objects
      //     counts: { total: 0, true: 0, false: 0, notSet: 0 }
      //   },
      //   ...
      // }
    };

    const usersWithoutGroup = []; // To track users without a groupName
    let processedCount = 0;
    let usersWithEmailCount = 0;

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
              }
            });

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
            }
          }
        } catch (error) {
          console.error(
            `Unexpected error processing attributes for user ${basicUser.Username}:`,
            error.message
          );
          continue; // Skip to next user on unexpected error
        }

        // If email is missing, log and skip
        if (!userEmail) {
          console.warn(
            `User ${basicUser.Username} has no email attribute. Not adding to results.`
          );
          continue; // Skip users without email
        }

        // At this point, the user has an email
        usersWithEmailCount++;

        // Create user data object
        const userData = {
          username: basicUser.Username,
          email: userEmail,
          notificationStatus: notificationStatusValue,
          group: userGroupName || "unknown",
        };

        // Add to appropriate group in our data structure
        if (userGroupName) {
          // Initialize group if it doesn't exist yet
          if (!groupedData[userGroupName]) {
            groupedData[userGroupName] = {
              users: [],
              counts: { total: 0, true: 0, false: 0, notSet: 0 },
            };
          }

          // Add user to group and update counts
          groupedData[userGroupName].users.push(userData);
          groupedData[userGroupName].counts.total++;

          if (notificationStatusValue === true) {
            groupedData[userGroupName].counts.true++;
          } else if (notificationStatusValue === false) {
            groupedData[userGroupName].counts.false++;
          } else {
            groupedData[userGroupName].counts.notSet++;
          }
        } else {
          // Track users without a group
          usersWithoutGroup.push(userData);
        }

        // Progress update every 10 users
        if (processedCount % 10 === 0 || processedCount === allUsers.length) {
          console.log(
            `Processed ${processedCount}/${allUsers.length} users (${Math.round(
              (processedCount / allUsers.length) * 100
            )}%). Found ${usersWithEmailCount} with email.`
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

    // Add the users without group to the data structure under a special key
    if (usersWithoutGroup.length > 0) {
      groupedData["NO_GROUP"] = {
        users: usersWithoutGroup,
        counts: {
          total: usersWithoutGroup.length,
          true: usersWithoutGroup.filter((u) => u.notificationStatus === true)
            .length,
          false: usersWithoutGroup.filter((u) => u.notificationStatus === false)
            .length,
          notSet: usersWithoutGroup.filter((u) => u.notificationStatus === null)
            .length,
        },
      };
    }

    // Generate combined CSV report
    let csvOutput = "Group,Email,Notification Status\n";

    // Add rows for each group
    Object.keys(groupedData).forEach((groupName) => {
      groupedData[groupName].users.forEach((user) => {
        csvOutput += `${groupName},${user.email},${
          user.notificationStatus === null ? "" : user.notificationStatus
        }\n`;
      });
    });

    // Generate per-group CSVs
    const groupCsvFiles = {};
    Object.keys(groupedData).forEach((groupName) => {
      let groupCsv = "Group,Email,Notification Status\n";
      groupedData[groupName].users.forEach((user) => {
        groupCsv += `${groupName},${user.email},${
          user.notificationStatus === null ? "" : user.notificationStatus
        }\n`;
      });
      groupCsvFiles[groupName] = groupCsv;
    });

    // Print analysis results
    console.log("\nUser Group Notification Status Report Results:");
    console.log("-------------------------------------------------------");
    console.log(`Total Cognito Users Scanned: ${allUsers.length}`);
    console.log(`Users with email: ${usersWithEmailCount}`);
    console.log(
      `Number of different groups found: ${Object.keys(groupedData).length}`
    );

    console.log("\nBreakdown by Group:");
    Object.keys(groupedData)
      .sort()
      .forEach((groupName) => {
        const groupStats = groupedData[groupName].counts;
        console.log(
          `\n### Group: ${
            groupName === "NO_GROUP" ? "NO GROUP" : groupName
          } ###`
        );
        console.log(`Total users: ${groupStats.total}`);
        console.log(`Notification Status:`);
        console.log(
          `  True: ${groupStats.true} (${
            Math.round((groupStats.true / groupStats.total) * 100) || 0
          }%)`
        );
        console.log(
          `  False: ${groupStats.false} (${
            Math.round((groupStats.false / groupStats.total) * 100) || 0
          }%)`
        );
        console.log(
          `  Not Set: ${groupStats.notSet} (${
            Math.round((groupStats.notSet / groupStats.total) * 100) || 0
          }%)`
        );
      });

    // Calculate overall notification status counts across all groups
    const totalTrueCount = Object.values(groupedData).reduce(
      (sum, group) => sum + group.counts.true,
      0
    );
    const totalFalseCount = Object.values(groupedData).reduce(
      (sum, group) => sum + group.counts.false,
      0
    );
    const totalNotSetCount = Object.values(groupedData).reduce(
      (sum, group) => sum + group.counts.notSet,
      0
    );

    console.log("\nOverall Notification Status Counts (across all groups):");
    console.log(
      `  True: ${totalTrueCount} (${
        Math.round((totalTrueCount / usersWithEmailCount) * 100) || 0
      }%)`
    );
    console.log(
      `  False: ${totalFalseCount} (${
        Math.round((totalFalseCount / usersWithEmailCount) * 100) || 0
      }%)`
    );
    console.log(
      `  Not Set: ${totalNotSetCount} (${
        Math.round((totalNotSetCount / usersWithEmailCount) * 100) || 0
      }%)`
    );

    return {
      counts: {
        totalUsers: allUsers.length,
        usersWithEmail: usersWithEmailCount,
        totalGroups: Object.keys(groupedData).length,
        totalTrue: totalTrueCount,
        totalFalse: totalFalseCount,
        totalNotSet: totalNotSetCount,
      },
      groupStats: groupedData,
      combinedCsv: csvOutput,
      groupCsvFiles: groupCsvFiles,
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
    // Call the report generation function
    const results = await generateAllGroupsNotificationReport(poolId);

    if (!results) {
      console.error(
        "\nReport generation did not complete successfully due to errors reported above."
      );
      process.exit(1);
    }

    // Summary output with clear statistics
    console.log("\n----- REPORT SUMMARY -----");
    console.log(`Total users found in Cognito: ${results.counts.totalUsers}`);
    console.log(`Users with email attribute: ${results.counts.usersWithEmail}`);
    console.log(`Number of groups found: ${results.counts.totalGroups}`);
    console.log("\nNotification status across all groups:");
    console.log(`  TRUE: ${results.counts.totalTrue}`);
    console.log(`  FALSE: ${results.counts.totalFalse}`);
    console.log(`  NOT SET: ${results.counts.totalNotSet}`);

    // Write output files
    try {
      const fs = await import("fs");
      const path = await import("path");
      const timestamp = new Date().toISOString().split("T")[0];

      // 1. Write combined CSV with all groups
      const combinedFileName = `all_groups_notifications_${timestamp}.csv`;
      const combinedFilePath = path.join(process.cwd(), combinedFileName);
      fs.writeFileSync(combinedFilePath, results.combinedCsv);
      console.log(`\nCombined CSV data written to: ${combinedFilePath}`);

      // 2. Write individual CSVs for each group
      const groupsDir = path.join(process.cwd(), "group_reports_" + timestamp);
      if (!fs.existsSync(groupsDir)) {
        fs.mkdirSync(groupsDir);
      }

      Object.keys(results.groupCsvFiles).forEach((groupName) => {
        const safeGroupName = groupName
          .replace(/[^a-z0-9]/gi, "_")
          .toLowerCase();
        const groupFileName = `${safeGroupName}_notifications_${timestamp}.csv`;
        const groupFilePath = path.join(groupsDir, groupFileName);
        fs.writeFileSync(groupFilePath, results.groupCsvFiles[groupName]);
      });
      console.log(`Individual group CSV files written to: ${groupsDir}/`);

      // 3. Extract emails by group
      Object.keys(results.groupStats).forEach((groupName) => {
        const safeGroupName = groupName
          .replace(/[^a-z0-9]/gi, "_")
          .toLowerCase();
        const emailsFileName = `${safeGroupName}_emails_${timestamp}.txt`;
        const emailsFilePath = path.join(groupsDir, emailsFileName);

        // Extract all emails for this group
        const groupEmails = results.groupStats[groupName].users.map(
          (user) => user.email
        );
        // Remove duplicates and sort
        const uniqueEmails = [...new Set(groupEmails)].sort();

        fs.writeFileSync(emailsFilePath, uniqueEmails.join("\n"));
      });
      console.log(`Email lists by group written to: ${groupsDir}/`);
    } catch (fileError) {
      console.error("\nFailed to write output files:", fileError.message);
      console.log("CSV output is still available in the results object.");
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

export { generateAllGroupsNotificationReport };
