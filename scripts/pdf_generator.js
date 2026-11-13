const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
    // Read HTML from stdin
    const html = fs.readFileSync(0, 'utf-8');

    if (!html) {
        console.error('No HTML provided on stdin');
        process.exit(1);
    }

    // puppeteer-core does not bundle a browser, so use the same Chromium as the scanner.
    let executablePath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
    if (!process.env.CHROMIUM_PATH && !process.env.PUPPETEER_EXECUTABLE_PATH && process.platform === 'darwin') {
        executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    const browser = await puppeteer.launch({
        executablePath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
            printBackground: true
        });

        // Write PDF bytes to stdout
        process.stdout.write(pdfBuffer);
    } catch (err) {
        console.error('Error generating PDF:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
