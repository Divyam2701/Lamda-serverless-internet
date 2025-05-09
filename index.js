const express = require('express');
const serverless = require('serverless-http');
const dns = require('dns').promises;
const mysql = require('mysql2/promise');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const app = express();

// Use environment variables or defaults
const REGION = process.env.REGION || 'us-west-1';
const SECRET_NAME = process.env.SECRET_NAME || 'rds-db-credentials';

// Fetch database credentials from Secrets Manager
async function getSecret() {
  const client = new SecretsManagerClient({ region: REGION });
  const command = new GetSecretValueCommand({ SecretId: SECRET_NAME });
  const response = await client.send(command);
  return JSON.parse(response.SecretString);
}

// Establish a database connection
async function getConnection() {
  const creds = await getSecret();
  return mysql.createConnection({
    host: creds.host,
    user: creds.username,
    password: creds.password,
    database: creds.dbname,
    port: creds.port || 3306,
  });
}

// Express route: Connect to RDS, perform DNS lookup, and show statuses accordingly
app.get('/', async (req, res) => {
  let dbTime;
  let googleIP;
  try {
    // Attempt to connect to RDS and fetch the current time
    const conn = await getConnection();
    const [rows] = await conn.query('SELECT NOW() AS now');
    dbTime = rows[0].now;
    await conn.end();
    
    // If RDS connection succeeded, perform DNS lookup
    try {
      const dnsResult = await dns.lookup('google.com');
      googleIP = dnsResult.address;
    } catch (dnsErr) {
      // In case DNS lookup fails, mark internet as inaccessible
      googleIP = "Not connected to Internet";
    }
    
    // Build a styled HTML page showing success statuses
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Connection Status</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              background-color: #f7f7f7; 
              margin: 0; 
              padding: 0; 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              min-height: 100vh; 
            }
            .container { 
              background: #fff; 
              padding: 20px 30px; 
              box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
              border-radius: 8px; 
              max-width: 600px; 
              width: 90%; 
            }
            h1 { 
              text-align: center; 
              color: #2c3e50; 
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-top: 20px; 
            }
            th, td { 
              padding: 12px 15px; 
              text-align: left; 
              border-bottom: 1px solid #ddd; 
            }
            th { 
              background-color: #ecf0f1; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Connection Status</h1>
            <table>
              <tr>
                <th>Message</th>
                <td>Connected to private RDS and Internet</td>
              </tr>
              <tr>
                <th>Database Time</th>
                <td>${dbTime}</td>
              </tr>
              <tr>
                <th>Google IP</th>
                <td>${googleIP}</td>
              </tr>
            </table>
          </div>
        </body>
      </html>
    `;
    
    res.status(200).send(html);
    
  } catch (err) {
    // If the DB connection fails, force both statuses to show errors.
    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Connection Error</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              background-color: #f7f7f7; 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              min-height: 100vh; 
            }
            .container { 
              background: #fff; 
              padding: 20px 30px; 
              box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
              border-radius: 8px; 
            }
            h1 { 
              color: #e74c3c; 
              text-align: center; 
            }
            p { 
              text-align: center; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Connection Error</h1>
            <table style="width:100%; border-collapse: collapse; margin-top: 20px;">
              <tr>
                <th style="padding: 12px 15px; text-align: left; background-color: #ecf0f1; border-bottom: 1px solid #ddd;">Database</th>
                <td style="padding: 12px 15px; text-align: left; border-bottom: 1px solid #ddd;">Not connected to RDS</td>
              </tr>
              <tr>
                <th style="padding: 12px 15px; text-align: left; background-color: #ecf0f1; border-bottom: 1px solid #ddd;">Internet</th>
                <td style="padding: 12px 15px; text-align: left; border-bottom: 1px solid #ddd;">Not connected to Internet</td>
              </tr>
            </table>
            <p>Error: ${err.message}</p>
          </div>
        </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// Export the handler for Lambda via serverless-http
module.exports.handler = serverless(app);
