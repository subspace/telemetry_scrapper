import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { activate, createConnection } from '@autonomys/auto-utils';
import { spacePledged } from '@autonomys/auto-consensus';

const TIMEOUT = 30000;
const MAX_RETRIES = 2;

async function runWithRetry(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error.message);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function scrapePageData(page, url, networkName) {
  console.log(`Navigating to ${networkName} page: ${url}`);
  
  await page.goto(url, {
    waitUntil: 'networkidle0',
    timeout: TIMEOUT
  });

  // Wait for initial load
  await new Promise(resolve => setTimeout(resolve, 3000));

  const stats = await page.evaluate((network) => {
    const getValue = (selector, required = true) => {
      try {
        const element = document.querySelector(selector);
        if (!element) return required ? 0 : null;
        const value = parseInt(element.textContent.trim());
        return isNaN(value) ? (required ? 0 : null) : value;
      } catch {
        return required ? 0 : null;
      }
    };

    const getXPathValue = (xpath, required = true) => {
      try {
        const element = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        if (!element) return required ? 0 : null;
        const value = parseInt(element.textContent.trim());
        return isNaN(value) ? (required ? 0 : null) : value;
      } catch {
        return required ? 0 : null;
      }
    };

    // For Taurus, spaceAcresNodeCount should be null
    const spaceAcresRequired = network !== 'taurus';

    const stats = {
      nodeCount: getValue('.Chains-chain-selected .Chains-node-count', true),
      subspaceNodeCount: getValue("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count", true),
      spaceAcresNodeCount: getValue("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count", spaceAcresRequired),
      linuxNodeCount: getXPathValue('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]', true),
      windowsNodeCount: getXPathValue('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]', true),
      macosNodeCount: getXPathValue('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]', true)
    };

    // Log values for debugging
    Object.entries(stats).forEach(([key, value]) => {
      console.log(`${network}: ${key} = ${value}`);
    });

    return stats;
  }, networkName);

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
    console.error(`Error fetching space pledged data for ${network}:`, error.message);
    throw error;
  }
}

async function appendToSheet(sheets, spreadsheetId, sheetName, data) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetName,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [data]
      },
    });
    console.log(`${sheetName} data appended successfully`);
  } catch (error) {
    console.error(`Error appending to ${sheetName}:`, error.message);
    throw error;
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

      const [taurusPage, geminiPage] = await Promise.all([
        browser.newPage(),
        browser.newPage()
      ]);

      // Enable console log collection for debugging
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

      // Append data in parallel
      await Promise.all([
        appendToSheet(sheets, spreadsheetId, 'taurus', [
          timestamp,
          taurusStats.nodeCount,
          taurusSpacePledged.toString(),
          taurusStats.subspaceNodeCount,
          taurusStats.spaceAcresNodeCount,
          taurusStats.linuxNodeCount,
          taurusStats.windowsNodeCount,
          taurusStats.macosNodeCount
        ]),
        appendToSheet(sheets, spreadsheetId, 'gemini-3h', [
          timestamp,
          geminiStats.nodeCount,
          geminiSpacePledged.toString(),
          geminiStats.subspaceNodeCount,
          geminiStats.spaceAcresNodeCount,
          geminiStats.linuxNodeCount,
          geminiStats.windowsNodeCount,
          geminiStats.macosNodeCount
        ])
      ]);

      return new Response(JSON.stringify({ 
        message: "Data updated successfully", 
        nextRun: next_run,
        stats: {
          taurus: taurusStats,
          gemini: geminiStats,
          spacePledged: {
            taurus: taurusSpacePledged.toString(),
            gemini: geminiSpacePledged.toString()
          }
        }
      }), {
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