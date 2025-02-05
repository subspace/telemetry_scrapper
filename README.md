1. First, install the required dependencies:
```bash
npm install
```
2. Create a .env file in the same directory as your script with these variables:
```bash
TELEMETRY_WEBSOCKET_URL=wss://telemetry.subspace.foundation/feed
# Google Cloud Service Account credentials
GOOGLE_CLOUD_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_CLOUD_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour Private Key Here\n-----END PRIVATE KEY-----"
GOOGLE_SHEET_ID=your-spreadsheet-id

# Optional: Add any network-specific configuration if needed for @autonomys/auto-utils
```

Here's what you need to do to get these credentials:
1. Google Cloud Setup:
    - Go to the Google Cloud Console (https://console.cloud.google.com)
    - Create a new project or select an existing one
    - Enable the Google Sheets API for your project
    - Create a Service Account:
        -  Go to "IAM & Admin" > "Service Accounts"
        - Click "Create Service Account"
        - Give it a name and grant it the "Editor" role
        - Create a key (JSON type)
        - Download the JSON file
2. Google Sheet Setup:
    - Create a new Google Sheet
    - Create two sheets named "taurus" and "mainnet"
    - Share the sheet with the service account email address (with editor access)
    - Copy the spreadsheet ID from the URL (it's the long string between /d/ and /edit in the URL)
3. To run the script:
```bash
node local-test-two-networks.js
```
The script will:
    - Launch headless Chrome browser instances
    - Scrape data from Subspace telemetry pages for both Taurus and mainnet networks
    - Fetch space pledged data using the @autonomys/auto-utils library
    - Write the collected data to your Google Sheet
Note: Make sure you have Node.js installed on your system. The script uses Puppeteer which will download a version of Chromium on first run.