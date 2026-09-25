import { defineConfig } from '@playwright/test';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Browser acceptance runs only on disposable GitHub runners');
export default defineConfig({testDir:'../test/browser',workers:1,retries:0,timeout:60000,reporter:'list',use:{browserName:'chromium',trace:'retain-on-failure'}});
