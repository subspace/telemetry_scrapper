const WebSocket = require('ws');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config();

async function getTelemetryData(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(process.env.TELEMETRY_WEBSOCKET_URL);

    const nodes = new Map();
    let isSubscribed = false;
    let lastNodeReceived = Date.now();

    ws.on('open', () => {
      console.log('Connected to Telemetry WebSocket');
      // Subscribe to the chain
      const chainId = '0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd';
      ws.send(`subscribe:${chainId}`);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        if (Array.isArray(message)) {
          const [actionCode, ...payload] = message;
          console.log('Raw message:', message);
          
          // Convert action code to number if it's a string
          const action = parseInt(actionCode);
          
          switch (action) {
            case 3: // Node details
              // Process each node detail group in the message
              for (let i = 0; i < payload.length; i++) {
                if (Array.isArray(payload[i]) && payload[i][0] !== undefined) {
                  const nodeData = payload[i];
                  const nodeId = nodeData[0];
                  const nodeDetails = nodeData[1];
                  
                  if (Array.isArray(nodeDetails) && nodeDetails.length >= 1) {
                    const [name, nodeType, version, , peerId] = nodeDetails;
                    const startupTime = nodeData[7]; // Last element contains startup timestamp
                    
                    nodes.set(nodeId, {
                      name: name,
                      lastRestart: new Date(startupTime).toISOString()
                    });
                    console.log('Added node:', name, 'startup:', new Date(startupTime).toISOString());
                    lastNodeReceived = Date.now();
                  }
                }
              }
              console.log('Current nodes count:', nodes.size);
              break;

            case 1: // Subscribe
            case 13: // SubscribedTo
              console.log('Subscription confirmed');
              isSubscribed = true;
              break;
          }
        }

        // Only resolve if we haven't received any new nodes for 15 seconds
        const timeSinceLastNode = Date.now() - lastNodeReceived;
        if (isSubscribed && nodes.size > 0 && timeSinceLastNode > 15000) {
          console.log(`No new nodes for ${timeSinceLastNode}ms, resolving with ${nodes.size} nodes`);
          const nodeArray = Array.from(nodes.values());
          ws.close();
          resolve({ nodes: nodeArray });
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });

    // Increase timeout to 120 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log('Timeout reached. Current state:', {
          isSubscribed,
          nodeCount: nodes.size,
          rawNodes: Array.from(nodes.entries())
        });
        ws.close();
        if (nodes.size > 0) {
          console.log(`Resolving with ${nodes.size} nodes after timeout`);
          resolve({ nodes: Array.from(nodes.values()) });
        } else {
          reject(new Error('Timeout waiting for telemetry data'));
        }
      }
    }, 120000); // 120 seconds
  });
}

async function runScript() {
  try {
    console.log("Function invoked locally at:", new Date().toISOString());

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Get the spreadsheet metadata
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const sheetTitle = `mainnet_${today}`;

    console.log(`Checking for sheet: ${sheetTitle}`);
    
    // Get existing sheets
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });

    // Check if sheet already exists
    const sheetExists = spreadsheet.data.sheets.some(
      sheet => sheet.properties.title === sheetTitle
    );

    if (!sheetExists) {
      console.log(`Sheet ${sheetTitle} does not exist, creating it...`);
      try {
        // Add new sheet one at a time
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: sheetTitle
                }
              }
            }]
          }
        });
        console.log(`Created new sheet: ${sheetTitle}`);

        // Add headers
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetTitle}!A1:C1`,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [['Timestamp', 'Node Name', 'Last Restart']]
          }
        });
        console.log('Added headers to new sheet');
      } catch (error) {
        console.log('Error creating new sheet, falling back to mainnet sheet');
        sheetTitle = 'mainnet';
      }
    } else {
      console.log(`Sheet ${sheetTitle} already exists`);
    }

    const mainnetStats = await getTelemetryData();
    const timestamp = new Date().toISOString();

    if (mainnetStats.nodes.length > 0) {
      const rows = mainnetStats.nodes.map(node => [
        timestamp,
        node.name,
        node.lastRestart
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: sheetTitle,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: rows
        },
      });
      console.log(`Data appended to sheet: ${sheetTitle}`);
      process.exit(0);
    } else {
      console.log('Skipping data append due to empty nodes');
      process.exit(1);
    }

  } catch (error) {
    console.error('Error details:', error);
    process.exit(1);
  }
}

runScript();