const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const { activate, createConnection } = require('@autonomys/auto-utils');
const { spacePledged } = require('@autonomys/auto-consensus');

dotenv.config();

async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (error) {
    console.log(`Timeout waiting for selector: ${selector}`);
    return false;
  }
}

async function scrapePageData(page, url, networkName) {
  console.log(`Navigating to ${networkName} page: ${url}`);
  
  // Navigate with longer timeout
  await page.goto(url, {
    waitUntil: 'networkidle0',
    timeout: 60000
  });

  console.log(`${networkName}: Initial page load complete`);

  // Wait for the chain selector to be visible
  const chainSelectorPresent = await waitForElement(page, '.Chains-chain-selected');
  if (!chainSelectorPresent) {
    console.log(`${networkName}: Chain selector not found after waiting`);
  }

  // Additional wait to ensure dynamic content loads
  await new Promise(resolve => setTimeout(resolve, 10000));
  console.log(`${networkName}: Completed initial wait period`);

  // Take a screenshot for debugging if needed
  await page.screenshot({ path: `${networkName}_debug.png` });

  // Try to click the element multiple times if needed
  let clickSuccess = false;
  for (let i = 0; i < 3; i++) {
    try {
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
          return true;
        }
        return false;
      });
      clickSuccess = true;
      break;
    } catch (error) {
      console.log(`${networkName}: Click attempt ${i + 1} failed`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  if (!clickSuccess) {
    console.log(`${networkName}: Failed to click the element after multiple attempts`);
  }

  // Wait after clicking
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(`${networkName}: Proceeding to extract stats`);

  const stats = await page.evaluate((network) => {
    const logValue = (name, value) => {
      console.log(`${network}: ${name} = ${value}`);
      return value;
    };

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
      return logValue('nodeCount', element ? parseInt(element.textContent) : null);
    })();

    const subspaceNodeCount = parseInt(getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count"));
    const spaceAcresNodeCount = parseInt(getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count"));

    const linuxNodeCount = parseInt(getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]'));
    const windowsNodeCount = parseInt(getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]'));
    const macosNodeCount = parseInt(getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]'));

    return {
      nodeCount,
      subspaceNodeCount: logValue('subspaceNodeCount', subspaceNodeCount),
      spaceAcresNodeCount: logValue('spaceAcresNodeCount', spaceAcresNodeCount),
      linuxNodeCount: logValue('linuxNodeCount', linuxNodeCount),
      windowsNodeCount: logValue('windowsNodeCount', windowsNodeCount),
      macosNodeCount: logValue('macosNodeCount', macosNodeCount)
    };
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
    console.error(`Error fetching space pledged data for ${network}:`, error);
    throw error;
  }
}

async function runScript() {
  let browser;
  try {
    console.log("Function invoked locally at:", new Date().toISOString());

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
    } else {
      console.log('Skipping Taurus data append due to null values');
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
    } else {
      console.log('Skipping Gemini data append due to null values');
    }

  } catch (error) {
    console.error('Error details:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

runScript();