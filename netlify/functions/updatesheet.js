import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { activate } from '@autonomys/auto-utils';
import { spacePledged } from '@autonomys/auto-consensus';

const TIMEOUT = 60000;

async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    console.log(`Timeout waiting for selector: ${selector}`);
    return false;
  }
}

async function scrapePageData(page, url, networkName) {
  console.log(`Navigating to ${networkName} page: ${url}`);
  
  await page.goto(url, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  const chainSelectorPresent = await waitForElement(page, '.Chains-chain-selected');
  if (!chainSelectorPresent) console.log(`${networkName}: Chain selector not found`);

  await new Promise(resolve => setTimeout(resolve, 10000));

  let clickSuccess = false;
  for (let i = 0; i < 3; i++) {
    try {
      await page.evaluate(() => {
        const element = document.evaluate(
          '//*[@id="root"]/div/div[2]/div[1]/div[6]/div[3]',
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;
        if (element) element.click();
      });
      clickSuccess = true;
      break;
    } catch {
      console.log(`${networkName}: Click attempt ${i + 1} failed`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!clickSuccess) console.log(`${networkName}: Failed to click element`);

  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const stats = await page.evaluate((network) => {
    const getTextBySelector = (selector) => {
      const element = document.querySelector(selector);
      return element ? parseInt(element.textContent.trim()) : null;
    };

    return {
      nodeCount: getTextBySelector('.Chains-chain-selected .Chains-node-count'),
      subspaceNodeCount: getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count"),
      spaceAcresNodeCount: getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count"),
      linuxNodeCount: getTextBySelector('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]'),
      windowsNodeCount: getTextBySelector('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]'),
      macosNodeCount: getTextBySelector('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]')
    };
  }, networkName);

  console.log(`${networkName} stats extracted:`, stats);
  return stats;
}

async function getSpacePledgedData(network) {
  try {
    const api = await activate({ networkId: network });
    const data = await spacePledged(api);
    console.log(`${network} space pledged data:`, data);
    return data;
  } catch (error) {
    console.error(`Error fetching space pledged data for ${network}:`, error);
    throw error;
  }
}

export default async (req) => {
  let browser;
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--dns-prefetch-disable'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const [taurusPage, geminiPage] = await Promise.all([browser.newPage(), browser.newPage()]);
    const [taurusStats, geminiStats] = await Promise.all([
      scrapePageData(taurusPage, 'https://telemetry.subspace.foundation/#list/0x295aeafca762a304d92ee1505548695091f6082d3f0aa4d092ac3cd6397a6c5e', 'taurus'),
      scrapePageData(geminiPage, 'https://telemetry.subspace.network/#list/0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd', 'gemini')
    ]);

    const [taurusSpacePledged, geminiSpacePledged] = await Promise.all([
      getSpacePledgedData('taurus'),
      getSpacePledgedData('mainnet')
    ]);

    const timestamp = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'taurus',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[timestamp, taurusStats.nodeCount, taurusSpacePledged, taurusStats.subspaceNodeCount, taurusStats.spaceAcresNodeCount, taurusStats.linuxNodeCount, taurusStats.windowsNodeCount, taurusStats.macosNodeCount]] },
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'mainnet',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[timestamp, geminiStats.nodeCount, geminiSpacePledged, geminiStats.subspaceNodeCount, geminiStats.spaceAcresNodeCount, geminiStats.linuxNodeCount, geminiStats.windowsNodeCount, geminiStats.macosNodeCount]] },
    });

    return new Response(JSON.stringify({ message: "Data updated successfully", stats: { taurus: taurusStats, gemini: geminiStats } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
};

export const config = { schedule: "@hourly" };
