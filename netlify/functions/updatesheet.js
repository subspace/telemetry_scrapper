import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { activate } from '@autonomys/auto-utils';
import { spacePledged } from '@autonomys/auto-consensus';

const MAX_RETRIES = 1;
const TIMEOUT = 30000; // 30 seconds

async function runWithRetry(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
}

export default async (req, context) => {
  return await runWithRetry(async () => {
    let browser;
    try {
      const { next_run } = req.body;
      console.log("Function invoked. Next run:", next_run);

      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;

      browser = await puppeteer.launch({
        args: [...chromium.args, '--no-sandbox'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });

      const page = await browser.newPage();

      await page.goto('https://telemetry.subspace.network/#/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34', {
        waitUntil: 'networkidle0',
        timeout: TIMEOUT
      });

      await page.click('.Chain-Tab[title="Stats"]');
      await page.waitForSelector('.Chain-content table', { timeout: TIMEOUT });
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for 0.5 seconds

      const stats = await page.evaluate(() => {
        const getTextByMultipleSelectors = (selectors) => {
          for (const selector of selectors) {
            let element;
            try {
              if (selector.startsWith('/')) {
                element = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              } else {
                element = document.querySelector(selector);
              }
              if (element) return element.textContent.trim();
            } catch (error) {}
          }
          return null;
        };

        return {
          nodeCount: getTextByMultipleSelectors(['.Chains-chain-selected .Chains-node-count']),
          subspaceNodeCount: getTextByMultipleSelectors([
            "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count",
            "//*[@id='root']/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[1]/td[2]",
            "/html/body/div/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[1]/td[2]"
          ]),
          spaceAcresNodeCount: getTextByMultipleSelectors([
            "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count",
            "//*[@id='root']/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[2]/td[2]",
            "/html/body/div/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[2]/td[2]"
          ]),
          linuxNodeCount: getTextByMultipleSelectors([
            "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(3) > table > tbody > tr:nth-child(1) > td.Stats-count",
            "//*[@id='root']/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]",
            "/html/body/div/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]"
          ]),
          windowsNodeCount: getTextByMultipleSelectors([
            "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(3) > table > tbody > tr:nth-child(2) > td.Stats-count",
            "//*[@id='root']/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]",
            "/html/body/div/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]"
          ]),
          macosNodeCount: getTextByMultipleSelectors([
            "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(3) > table > tbody > tr:nth-child(3) > td.Stats-count",
            "//*[@id='root']/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]",
            "/html/body/div/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]"
          ])
        };
      });

      // Fetch the spacePledged using @autonomys/auto-utils and @autonomys/auto-consensus
      console.log('Fetching spacePledged...');
      const api = await activate({ networkId: 'taurus' });
      const spacePledgedData = await spacePledged(api);

      const timestamp = new Date().toISOString();

      console.log('Data extracted:', { ...stats, spacePledged: spacePledgedData.toString() });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'taurus',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            timestamp, 
            stats.nodeCount || '', 
            spacePledgedData.toString(), 
            stats.subspaceNodeCount || '', 
            stats.spaceAcresNodeCount || '',
            stats.linuxNodeCount || '',
            stats.windowsNodeCount || '',
            stats.macosNodeCount || ''
          ]]
        },
      });

      console.log('Data appended to Google Sheet');
      return new Response(JSON.stringify({ message: "Data updated successfully", nextRun: next_run }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error:', error.message);
      throw error;
    } finally {
      if (browser) await browser.close();
    }
  });
}

export const config = {
  schedule: "@daily"
};
