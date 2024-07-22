import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import axios from 'axios';

export default async (req, context) => {
  try {
    const { next_run } = JSON.parse(req.body);
    console.log("Function invoked. Next run scheduled for:", next_run);

    // Your existing code here...

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Data updated successfully", nextRun: next_run }),
    };
  } catch (error) {
    console.error('Error details:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to update data", details: error.message }),
    };
  }
}

export const config = {
  schedule: "@hourly"
}