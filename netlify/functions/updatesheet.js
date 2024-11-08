import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { activate } from '@autonomys/auto-utils';
import { spacePledged } from '@autonomys/auto-consensus';

const MAX_RETRIES = 3;
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

async function scrapeNetwork(page, url, networkId) {
  await page.goto(url, {
    waitUntil: 'networkidle0',
    timeout: TIMEOUT
  });

  await page.click('.Chain-Tab[title="Stats"]');
  await page.waitForSelector('.Chain-content table', { timeout: TIMEOUT });
  await new Promise(resolve => setTimeout(resolve, 500));

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

  console.log(`Fetching spacePledged for ${networkId}...`);
  const api = await activate({ networkId });
  const spacePledgedData = await spacePledged(api);

  return { stats, spacePledgedData };
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

      const taurusPage = await browser.newPage();
      const mainnetPage = await browser.newPage();

      const [taurusData, mainnetData] = await Promise.all([
        scrapeNetwork(
          taurusPage,
          'https://telemetry.subspace.foundation/#list/0x295aeafca762a304d92ee1505548695091f6082d3f0aa4d092ac3cd6397a6c5e',
          'taurus'
        ),
        scrapeNetwork(
          mainnetPage,
          'https://telemetry.subspace.network/#list/0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd',
          'mainnet'
        )
      ]);

      const timestamp = new Date().toISOString();

      console.log('Data extracted:', {
        taurus: { ...taurusData.stats, spacePledged: taurusData.spacePledgedData.toString() },
        mainnet: { ...mainnetData.stats, spacePledged: mainnetData.spacePledgedData.toString() }
      });

      // Save both networks' data
      await Promise.all([
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'taurus',
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[
              timestamp,
              taurusData.stats.nodeCount || '',
              taurusData.spacePledgedData.toString(),
              taurusData.stats.subspaceNodeCount || '',
              taurusData.stats.spaceAcresNodeCount || '',
              taurusData.stats.linuxNodeCount || '',
              taurusData.stats.windowsNodeCount || '',
              taurusData.stats.macosNodeCount || ''
            ]]
          },
        }),
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'mainnet',
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[
              timestamp,
              mainnetData.stats.nodeCount || '',
              mainnetData.spacePledgedData.toString(),
              mainnetData.stats.subspaceNodeCount || '',
              mainnetData.stats.spaceAcresNodeCount || '',
              mainnetData.stats.linuxNodeCount || '',
              mainnetData.stats.windowsNodeCount || '',
              mainnetData.stats.macosNodeCount || ''
            ]]
          },
        })
      ]);

      console.log('Data appended to Google Sheets');
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
  schedule: "@hourly"
};