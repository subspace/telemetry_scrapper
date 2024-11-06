import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { activate, createConnection } from '@autonomys/auto-utils';
import { spacePledged } from '@autonomys/auto-consensus';

const TIMEOUT = 60000; // Increased timeout to match working version

async function scrapePageData(page, url, networkName) {
  console.log(`Navigating to ${networkName} page: ${url}`);
  
  await page.goto(url, {
    waitUntil: 'networkidle0',
    timeout: TIMEOUT
  });

  // Wait for initial load, matching the working version's timing
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Click on the stats tab
  console.log(`${networkName}: Clicking on stats tab...`);
  await page.evaluate(() => {
    const element = document.evaluate(
      '//*[@id="root"]/div/div[2]/div[1]/div[6]/div[3]',
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    if (element) {
      element.click();
    } else {
      console.log('Element not found');
    }
  });

  // Wait after clicking
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(`${networkName}: Extracting stats...`);
  const stats = await page.evaluate(() => {
    const getTextBySelector = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : null;
    };

    const getTextByXPath = (xpath) => {
      const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      return element ? element.textContent.trim() : null;
    };

    const nodeCount = (() => {
      const element = document.querySelector('.Chains-chain-selected .Chains-node-count');
      return element ? parseInt(element.textContent) : null;
    })();

    const subspaceNodeCount = getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count");
    const spaceAcresNodeCount = getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count");

    const linuxNodeCount = getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]');
    const windowsNodeCount = getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]');
    const macosNodeCount = getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]');

    return {
      nodeCount,
      subspaceNodeCount: subspaceNodeCount ? parseInt(subspaceNodeCount) : null,
      spaceAcresNodeCount: spaceAcresNodeCount ? parseInt(spaceAcresNodeCount) : null,
      linuxNodeCount: linuxNodeCount ? parseInt(linuxNodeCount) : null,
      windowsNodeCount: windowsNodeCount ? parseInt(windowsNodeCount) : null,
      macosNodeCount: macosNodeCount ? parseInt(macosNodeCount) : null
    };
  });

  console.log(`${networkName} stats extracted:`, stats);
  return stats;
}

async function getSpacePledgedData(network) {
  console.log(`Fetching space pledged data for ${network}`);
  try {
    if (network === 'taurus') {
      const api = await activate({ networkId: 'taurus' });
      const data = await spacePledged(api);
      console.log(`${network} space pledged data:`, data);
      return data;
    } else if (network === 'gemini') {
      const api = await createConnection('wss://rpc-1.gemini-3h.subspace.network/ws');
      const data = await spacePledged(api);
      console.log(`${network} space pledged data:`, data);
      return data;
    }
  } catch (error) {
    console.error(`Error fetching space pledged data for ${network}:`, error);
    throw error;
  }
}

export default async (req, context) => {
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

    const [taurusPage, geminiPage] = await Promise.all([
      browser.newPage(),
      browser.newPage()
    ]);

    // Enable console log collection
    taurusPage.on('console', msg => console.log('Taurus Page Console:', msg.text()));
    geminiPage.on('console', msg => console.log('Gemini Page Console:', msg.text()));

    const [taurusStats, geminiStats] = await Promise.all([
      scrapePageData(taurusPage, 'https://telemetry.subspace.foundation/#list/0x295aeafca762a304d92ee1505548695091f6082d3f0aa4d092ac3cd6397a6c5e', 'taurus'),
      scrapePageData(geminiPage, 'https://telemetry.subspace.network/#list/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34', 'gemini')
    ]);

    const [taurusSpacePledged, geminiSpacePledged] = await Promise.all([
      getSpacePledgedData('taurus'),
      getSpacePledgedData('gemini')
    ]);

    const timestamp = new Date().toISOString();

    // Only append data if stats are not null
    if (taurusStats.nodeCount !== null) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'taurus',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            timestamp,
            taurusStats.nodeCount,
            taurusSpacePledged.toString(),
            taurusStats.subspaceNodeCount,
            taurusStats.spaceAcresNodeCount,
            taurusStats.linuxNodeCount,
            taurusStats.windowsNodeCount,
            taurusStats.macosNodeCount
          ]]
        },
      });
      console.log('Taurus data appended to Google Sheet');
    }

    if (geminiStats.nodeCount !== null) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'gemini-3h',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            timestamp,
            geminiStats.nodeCount,
            geminiSpacePledged.toString(),
            geminiStats.subspaceNodeCount,
            geminiStats.spaceAcresNodeCount,
            geminiStats.linuxNodeCount,
            geminiStats.windowsNodeCount,
            geminiStats.macosNodeCount
          ]]
        },
      });
      console.log('Gemini data appended to Google Sheet');
    }

    return new Response(JSON.stringify({
      message: "Data updated successfully",
      nextRun: next_run,
      stats: { taurus: taurusStats, gemini: geminiStats }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export const config = {
  schedule: "@hourly"
};