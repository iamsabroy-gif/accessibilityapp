#!/usr/bin/env node
/**
 * a11yscan — Accessibility scanner CLI for CI/CD pipelines.
 *
 * 73 automated WCAG 2.1/2.2 checks mapped to A/AA/AAA success criteria.
 * Runs entirely inside the CI runner — no hosted API, no auth required.
 *
 * Exit codes:
 *   0 — no violations at or above --fail-on
 *   1 — threshold breached (build should fail)
 *   2 — scan error (page unreachable, browser crash)
 */

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const { scan } = require('../src/scan');
const { evaluateThreshold } = require('../src/threshold');
const { formatJSON } = require('../src/format/json');
const { formatSARIF } = require('../src/format/sarif');
const { formatJUnit } = require('../src/format/junit');

const program = new Command();

program
  .name('a11yscan')
  .description('Accessibility scanner — 73 automated WCAG 2.1/2.2 checks for CI/CD pipelines')
  .version('0.1.0')
  .argument('[urls...]', 'URLs to scan')
  .option('--urls-file <path>', 'File containing URLs to scan (one per line)')
  .option('--wcag-level <level>', 'WCAG conformance level: A, AA, or AAA', 'AA')
  .option('--fail-on <level>', 'Minimum impact to fail: critical, serious, moderate, minor, none', 'serious')
  .option('--warn-on <level>', 'Minimum impact to warn: critical, serious, moderate, minor, none', 'moderate')
  .option('--format <formats>', 'Output formats (comma-separated): json, sarif, junit', 'json')
  .option('--output-dir <dir>', 'Directory to write results', './a11y-results')
  .option('--timeout <seconds>', 'Page navigation timeout in seconds', '180')
  .action(async (urls, options) => {
    // Collect URLs from arguments and --urls-file
    const allUrls = [...urls];

    if (options.urlsFile) {
      try {
        const content = fs.readFileSync(options.urlsFile, 'utf8');
        const fileUrls = content
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
        allUrls.push(...fileUrls);
      } catch (err) {
        console.error(`Error reading URLs file: ${err.message}`);
        process.exit(2);
      }
    }

    if (allUrls.length === 0) {
      console.error('Error: No URLs provided. Pass URLs as arguments or use --urls-file.');
      program.help();
      process.exit(2);
    }

    // Parse format list
    const formats = options.format.split(',').map(f => f.trim().toLowerCase());
    const validFormats = ['json', 'sarif', 'junit'];
    for (const f of formats) {
      if (!validFormats.includes(f)) {
        console.error(`Error: Unknown format '${f}'. Valid formats: ${validFormats.join(', ')}`);
        process.exit(2);
      }
    }

    // Validate levels
    const validLevels = ['critical', 'serious', 'moderate', 'minor', 'none'];
    if (!validLevels.includes(options.failOn)) {
      console.error(`Error: Invalid --fail-on level '${options.failOn}'. Valid: ${validLevels.join(', ')}`);
      process.exit(2);
    }
    if (!validLevels.includes(options.warnOn)) {
      console.error(`Error: Invalid --warn-on level '${options.warnOn}'. Valid: ${validLevels.join(', ')}`);
      process.exit(2);
    }

    const validWcagLevels = ['A', 'AA', 'AAA'];
    if (!validWcagLevels.includes(options.wcagLevel.toUpperCase())) {
      console.error(`Error: Invalid --wcag-level '${options.wcagLevel}'. Valid: ${validWcagLevels.join(', ')}`);
      process.exit(2);
    }

    // Ensure output directory
    const outputDir = path.resolve(options.outputDir);
    fs.mkdirSync(outputDir, { recursive: true });

    const timeout = parseInt(options.timeout, 10);
    let globalExitCode = 0;
    let hadScanError = false;

    console.log(`\n🔍 a11yscan v0.1.0`);
    console.log(`   WCAG Level: ${options.wcagLevel.toUpperCase()}`);
    console.log(`   Fail on: ${options.failOn} | Warn on: ${options.warnOn}`);
    console.log(`   Formats: ${formats.join(', ')}`);
    console.log(`   URLs: ${allUrls.length}\n`);

    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      const urlLabel = allUrls.length > 1 ? `[${i + 1}/${allUrls.length}] ` : '';

      console.log(`${urlLabel}Scanning: ${url}`);

      const scanResult = await scan(url, {
        wcagLevel: options.wcagLevel,
        timeout,
      });

      if (scanResult.error) {
        console.error(`  ❌ Scan error: ${scanResult.error}`);
        hadScanError = true;
        continue;
      }

      // Apply threshold evaluation
      const thresholdResult = evaluateThreshold(scanResult.violations, {
        failOn: options.failOn,
        warnOn: options.warnOn,
      });

      // Update global exit code
      if (thresholdResult.exitCode > globalExitCode) {
        globalExitCode = thresholdResult.exitCode;
      }

      // Print summary
      const { summary } = thresholdResult;
      const statusIcon = summary.passed ? '✅' : '❌';
      console.log(`  ${statusIcon} ${summary.total} violations (${summary.failures} fail, ${summary.warnings} warn, ${summary.info} info)`);

      if (thresholdResult.failures.length > 0) {
        console.log('  Failing violations:');
        for (const f of thresholdResult.failures) {
          const nodeCount = f.nodes ? f.nodes.length : 0;
          console.log(`    • ${f.id} [${f.impact}] — ${nodeCount} node(s): ${f.help || f.description || ''}`);
        }
      }

      // Sanitize URL for filename
      const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80);

      // Write output files
      for (const fmt of formats) {
        let content, ext;
        switch (fmt) {
          case 'json':
            content = formatJSON(scanResult, thresholdResult);
            ext = 'json';
            break;
          case 'sarif':
            content = formatSARIF(scanResult, thresholdResult);
            ext = 'sarif';
            break;
          case 'junit':
            content = formatJUnit(scanResult, thresholdResult);
            ext = 'xml';
            break;
        }

        const outFile = path.join(outputDir, `${safeUrl}.${ext}`);
        fs.writeFileSync(outFile, content, 'utf8');
        console.log(`  📄 ${fmt}: ${outFile}`);
      }

      console.log('');
    }

    // Final summary
    console.log('─'.repeat(60));
    if (hadScanError) {
      console.log('⚠️  Some scans encountered errors (exit code 2).');
      process.exit(2);
    } else if (globalExitCode > 0) {
      console.log(`❌ Threshold breached — exit code ${globalExitCode}`);
      process.exit(globalExitCode);
    } else {
      console.log('✅ All scans passed.');
      process.exit(0);
    }
  });

program.parse();
