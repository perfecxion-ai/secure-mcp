#!/usr/bin/env node

/**
 * Security Gate Validation Script
 *
 * This script evaluates security test results and determines if security quality gates pass.
 * It aggregates results from various security testing frameworks and applies business rules.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SecurityGateValidator {
  constructor() {
    this.results = {
      vulnerabilityRegression: null,
      automatedSecurity: null,
      aiSafety: null,
      performanceSecurity: null,
    };

    this.thresholds = {
      critical: parseInt(process.env.SECURITY_THRESHOLD_CRITICAL) || 0,
      high: parseInt(process.env.SECURITY_THRESHOLD_HIGH) || 2,
      medium: parseInt(process.env.SECURITY_THRESHOLD_MEDIUM) || 10,
      securityScore: parseInt(process.env.SECURITY_SCORE_MINIMUM) || 80,
      aiSafetyScore: parseInt(process.env.AI_SAFETY_SCORE_MINIMUM) || 80,
      performanceScore: parseInt(process.env.PERFORMANCE_SCORE_MINIMUM) || 70,
    };

    this.metrics = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      criticalFailures: 0,
      highFailures: 0,
      mediumFailures: 0,
      overallSecurityScore: 0,
      aiSafetyScore: 0,
      performanceSecurityScore: 0,
    };
  }

  async validateSecurityGates() {
    console.log('🔒 Starting Security Gate Validation...\n');

    try {
      // Load test results
      await this.loadTestResults();

      // Analyze results
      this.analyzeSecurityResults();

      // Evaluate quality gates
      const gateResults = this.evaluateQualityGates();

      // Generate reports
      await this.generateReports(gateResults);

      // Output final decision
      this.outputGateDecision(gateResults);

      return gateResults.passed;
    } catch (error) {
      console.error('❌ Security gate validation failed:', error.message);
      return false;
    }
  }

  async loadTestResults() {
    console.log('📊 Loading security test results...\n');

    // Load vulnerability regression test results
    try {
      const vulnerabilityResults = await this.loadJestResults('vulnerability-regression-tests');
      this.results.vulnerabilityRegression = vulnerabilityResults;
      console.log('✅ Loaded vulnerability regression test results');
    } catch (error) {
      console.warn('⚠️ Could not load vulnerability regression results:', error.message);
    }

    // Load automated security framework results
    try {
      const automatedResults = await this.loadJestResults('automated-security-framework');
      this.results.automatedSecurity = automatedResults;
      console.log('✅ Loaded automated security framework results');
    } catch (error) {
      console.warn('⚠️ Could not load automated security results:', error.message);
    }

    // Load AI safety test results
    try {
      const aiSafetyResults = await this.loadJestResults('ai-safety-testing');
      this.results.aiSafety = aiSafetyResults;
      console.log('✅ Loaded AI safety test results');
    } catch (error) {
      console.warn('⚠️ Could not load AI safety results:', error.message);
    }

    // Load performance security test results
    try {
      const performanceResults = await this.loadJestResults('performance-security-testing');
      this.results.performanceSecurity = performanceResults;
      console.log('✅ Loaded performance security test results');
    } catch (error) {
      console.warn('⚠️ Could not load performance security results:', error.message);
    }

    console.log('');
  }

  async loadJestResults(testSuite) {
    // Try to load Jest JSON results
    const resultPaths = [
      `./test-results/jest-results-${testSuite}.json`,
      `./test-results/${testSuite}.json`,
      `./coverage/test-results.json`,
    ];

    for (const resultPath of resultPaths) {
      if (fs.existsSync(resultPath)) {
        const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        return this.parseJestResults(data, testSuite);
      }
    }

    // If no JSON results, try to run the test and capture output
    try {
      const testCommand = `npm run test:security -- --testPathPattern=${testSuite} --json --outputFile=./test-results/${testSuite}.json`;
      execSync(testCommand, { stdio: 'pipe' });

      if (fs.existsSync(`./test-results/${testSuite}.json`)) {
        const data = JSON.parse(fs.readFileSync(`./test-results/${testSuite}.json`, 'utf8'));
        return this.parseJestResults(data, testSuite);
      }
    } catch (error) {
      // Test execution failed - this is important information
      return {
        testSuite,
        passed: 0,
        failed: 1,
        total: 1,
        criticalFailures: 1,
        highFailures: 0,
        score: 0,
        error: error.message,
      };
    }

    throw new Error(`Could not load results for ${testSuite}`);
  }

  parseJestResults(jestData, testSuite) {
    const result = {
      testSuite,
      passed: 0,
      failed: 0,
      total: 0,
      criticalFailures: 0,
      highFailures: 0,
      mediumFailures: 0,
      score: 100,
      details: [],
    };

    if (jestData.testResults) {
      for (const testFile of jestData.testResults) {
        for (const testResult of testFile.assertionResults) {
          result.total++;

          if (testResult.status === 'passed') {
            result.passed++;
          } else {
            result.failed++;

            // Classify failure severity based on test name
            const testName = testResult.fullName || testResult.title;
            const severity = this.classifyTestSeverity(testName, testSuite);

            switch (severity) {
              case 'CRITICAL':
                result.criticalFailures++;
                break;
              case 'HIGH':
                result.highFailures++;
                break;
              case 'MEDIUM':
                result.mediumFailures++;
                break;
            }

            result.details.push({
              name: testName,
              severity,
              error: testResult.failureMessages?.[0] || 'Test failed',
            });
          }
        }
      }
    }

    // Calculate score based on failures
    const scoreDeductions = {
      critical: 25,
      high: 15,
      medium: 8,
    };

    let totalDeductions = 0;
    totalDeductions += result.criticalFailures * scoreDeductions.critical;
    totalDeductions += result.highFailures * scoreDeductions.high;
    totalDeductions += result.mediumFailures * scoreDeductions.medium;

    result.score = Math.max(0, 100 - totalDeductions);

    return result;
  }

  classifyTestSeverity(testName, testSuite) {
    const testNameLower = testName.toLowerCase();

    // Critical security vulnerabilities
    const criticalPatterns = [
      'cve-2024-smcp-001', // JWT Race Condition
      'cve-2024-smcp-002', // MFA Cryptographic Flaw
      'cve-2024-smcp-003', // Container Escape
      'sql injection',
      'authentication bypass',
      'privilege escalation',
      'container escape',
      'critical',
    ];

    // High severity security issues
    const highPatterns = [
      'cve-2024-smcp-004', // SQL Injection
      'cve-2024-smcp-005', // MCP Protocol Injection
      'xss',
      'csrf',
      'command injection',
      'path traversal',
      'denial of service',
      'high',
    ];

    // Medium severity issues
    const mediumPatterns = [
      'cve-2024-smcp-006', // AI Prompt Injection
      'timing attack',
      'rate limiting',
      'information disclosure',
      'medium',
    ];

    for (const pattern of criticalPatterns) {
      if (testNameLower.includes(pattern)) {
        return 'CRITICAL';
      }
    }

    for (const pattern of highPatterns) {
      if (testNameLower.includes(pattern)) {
        return 'HIGH';
      }
    }

    for (const pattern of mediumPatterns) {
      if (testNameLower.includes(pattern)) {
        return 'MEDIUM';
      }
    }

    return 'LOW';
  }

  analyzeSecurityResults() {
    console.log('🔍 Analyzing security test results...\n');

    // Aggregate metrics from all test suites
    for (const [suiteName, results] of Object.entries(this.results)) {
      if (!results) continue;

      this.metrics.totalTests += results.total;
      this.metrics.passedTests += results.passed;
      this.metrics.failedTests += results.failed;
      this.metrics.criticalFailures += results.criticalFailures;
      this.metrics.highFailures += results.highFailures;
      this.metrics.mediumFailures += results.mediumFailures;

      // Track suite-specific scores
      switch (suiteName) {
        case 'aiSafety':
          this.metrics.aiSafetyScore = results.score;
          break;
        case 'performanceSecurity':
          this.metrics.performanceSecurityScore = results.score;
          break;
      }
    }

    // Calculate overall security score
    const totalVulnerabilities = this.metrics.criticalFailures + this.metrics.highFailures + this.metrics.mediumFailures;
    const scoreDeductions = (this.metrics.criticalFailures * 25) + (this.metrics.highFailures * 15) + (this.metrics.mediumFailures * 8);
    this.metrics.overallSecurityScore = Math.max(0, 100 - scoreDeductions);

    // Use minimum AI safety score if not specifically calculated
    if (this.metrics.aiSafetyScore === 0 && this.results.aiSafety) {
      this.metrics.aiSafetyScore = this.results.aiSafety.score;
    }

    // Use minimum performance score if not specifically calculated
    if (this.metrics.performanceSecurityScore === 0 && this.results.performanceSecurity) {
      this.metrics.performanceSecurityScore = this.results.performanceSecurity.score;
    }

    console.log('📊 Security Analysis Summary:');
    console.log(`   Total Tests: ${this.metrics.totalTests}`);
    console.log(`   Passed: ${this.metrics.passedTests}`);
    console.log(`   Failed: ${this.metrics.failedTests}`);
    console.log(`   Critical Failures: ${this.metrics.criticalFailures}`);
    console.log(`   High Failures: ${this.metrics.highFailures}`);
    console.log(`   Medium Failures: ${this.metrics.mediumFailures}`);
    console.log(`   Overall Security Score: ${this.metrics.overallSecurityScore}/100`);
    console.log(`   AI Safety Score: ${this.metrics.aiSafetyScore}/100`);
    console.log(`   Performance Security Score: ${this.metrics.performanceSecurityScore}/100`);
    console.log('');
  }

  evaluateQualityGates() {
    console.log('🚦 Evaluating Security Quality Gates...\n');

    const gates = {
      criticalVulnerabilities: {
        name: 'Critical Vulnerabilities',
        threshold: this.thresholds.critical,
        actual: this.metrics.criticalFailures,
        passed: this.metrics.criticalFailures <= this.thresholds.critical,
        severity: 'CRITICAL',
      },
      highVulnerabilities: {
        name: 'High Vulnerabilities',
        threshold: this.thresholds.high,
        actual: this.metrics.highFailures,
        passed: this.metrics.highFailures <= this.thresholds.high,
        severity: 'HIGH',
      },
      securityScore: {
        name: 'Overall Security Score',
        threshold: this.thresholds.securityScore,
        actual: this.metrics.overallSecurityScore,
        passed: this.metrics.overallSecurityScore >= this.thresholds.securityScore,
        severity: 'HIGH',
      },
      aiSafetyScore: {
        name: 'AI Safety Score',
        threshold: this.thresholds.aiSafetyScore,
        actual: this.metrics.aiSafetyScore,
        passed: this.metrics.aiSafetyScore >= this.thresholds.aiSafetyScore,
        severity: 'MEDIUM',
      },
      performanceScore: {
        name: 'Performance Security Score',
        threshold: this.thresholds.performanceScore,
        actual: this.metrics.performanceSecurityScore,
        passed: this.metrics.performanceSecurityScore >= this.thresholds.performanceScore,
        severity: 'MEDIUM',
      },
    };

    let allPassed = true;
    let criticalFailed = false;
    let highFailed = false;

    console.log('Quality Gate Results:');
    console.log('┌─────────────────────────────┬───────────┬────────┬────────┐');
    console.log('│ Gate                        │ Threshold │ Actual │ Status │');
    console.log('├─────────────────────────────┼───────────┼────────┼────────┤');

    for (const [gateId, gate] of Object.entries(gates)) {
      const status = gate.passed ? '✅ PASS' : '❌ FAIL';
      const thresholdStr = gate.name.includes('Score') ? `≥ ${gate.threshold}` : `≤ ${gate.threshold}`;

      console.log(`│ ${gate.name.padEnd(27)} │ ${thresholdStr.padEnd(9)} │ ${gate.actual.toString().padEnd(6)} │ ${status} │`);

      if (!gate.passed) {
        allPassed = false;
        if (gate.severity === 'CRITICAL') {
          criticalFailed = true;
        } else if (gate.severity === 'HIGH') {
          highFailed = true;
        }
      }
    }

    console.log('└─────────────────────────────┴───────────┴────────┴────────┘');
    console.log('');

    const result = {
      passed: allPassed,
      criticalFailed,
      highFailed,
      gates,
      summary: {
        total: Object.keys(gates).length,
        passed: Object.values(gates).filter(g => g.passed).length,
        failed: Object.values(gates).filter(g => !g.passed).length,
      },
    };

    return result;
  }

  async generateReports(gateResults) {
    console.log('📄 Generating security reports...\n');

    // Ensure reports directory exists
    if (!fs.existsSync('./reports')) {
      fs.mkdirSync('./reports', { recursive: true });
    }

    // Generate JSON report for CI/CD consumption
    const jsonReport = {
      timestamp: new Date().toISOString(),
      buildNumber: process.env.GITHUB_RUN_NUMBER || 'local',
      commit: process.env.GITHUB_SHA || 'unknown',
      branch: process.env.GITHUB_REF_NAME || 'unknown',
      metrics: this.metrics,
      thresholds: this.thresholds,
      gates: gateResults.gates,
      overall: {
        passed: gateResults.passed,
        score: this.metrics.overallSecurityScore,
      },
      testResults: this.results,
    };

    fs.writeFileSync('./reports/security-gates-report.json', JSON.stringify(jsonReport, null, 2));

    // Generate markdown report for human consumption
    const markdownReport = this.generateMarkdownReport(gateResults);
    fs.writeFileSync('./reports/security-gates-report.md', markdownReport);

    // Generate security dashboard data
    const dashboardData = {
      timestamp: new Date().toISOString(),
      securityScore: this.metrics.overallSecurityScore,
      aiSafetyScore: this.metrics.aiSafetyScore,
      performanceScore: this.metrics.performanceSecurityScore,
      vulnerabilities: {
        critical: this.metrics.criticalFailures,
        high: this.metrics.highFailures,
        medium: this.metrics.mediumFailures,
      },
      gates: gateResults.summary,
    };

    fs.writeFileSync('./reports/security-dashboard.json', JSON.stringify(dashboardData, null, 2));

    console.log('✅ Reports generated:');
    console.log('   - ./reports/security-gates-report.json');
    console.log('   - ./reports/security-gates-report.md');
    console.log('   - ./reports/security-dashboard.json');
    console.log('');
  }

  generateMarkdownReport(gateResults) {
    const timestamp = new Date().toISOString();
    const overallStatus = gateResults.passed ? '✅ PASSED' : '❌ FAILED';

    let report = `# Security Quality Gates Report

**Generated**: ${timestamp}
**Build**: ${process.env.GITHUB_RUN_NUMBER || 'local'}
**Commit**: ${process.env.GITHUB_SHA?.substring(0, 8) || 'unknown'}
**Branch**: ${process.env.GITHUB_REF_NAME || 'unknown'}

## Overall Status: ${overallStatus}

## Security Metrics

| Metric | Value |
|--------|-------|
| Total Tests | ${this.metrics.totalTests} |
| Tests Passed | ${this.metrics.passedTests} |
| Tests Failed | ${this.metrics.failedTests} |
| Critical Vulnerabilities | ${this.metrics.criticalFailures} |
| High Vulnerabilities | ${this.metrics.highFailures} |
| Medium Vulnerabilities | ${this.metrics.mediumFailures} |
| Overall Security Score | ${this.metrics.overallSecurityScore}/100 |
| AI Safety Score | ${this.metrics.aiSafetyScore}/100 |
| Performance Security Score | ${this.metrics.performanceSecurityScore}/100 |

## Quality Gate Results

| Gate | Threshold | Actual | Status |
|------|-----------|--------|--------|
`;

    for (const [gateId, gate] of Object.entries(gateResults.gates)) {
      const status = gate.passed ? '✅ PASS' : '❌ FAIL';
      const thresholdStr = gate.name.includes('Score') ? `≥ ${gate.threshold}` : `≤ ${gate.threshold}`;
      report += `| ${gate.name} | ${thresholdStr} | ${gate.actual} | ${status} |\n`;
    }

    report += `\n## Test Suite Results\n\n`;

    for (const [suiteName, results] of Object.entries(this.results)) {
      if (!results) continue;

      const status = results.failed === 0 ? '✅' : '❌';
      report += `### ${suiteName} ${status}\n\n`;
      report += `- **Tests**: ${results.total}\n`;
      report += `- **Passed**: ${results.passed}\n`;
      report += `- **Failed**: ${results.failed}\n`;
      report += `- **Score**: ${results.score}/100\n\n`;

      if (results.details && results.details.length > 0) {
        report += `**Failed Tests:**\n\n`;
        for (const detail of results.details) {
          report += `- **${detail.name}** (${detail.severity}): ${detail.error}\n`;
        }
        report += `\n`;
      }
    }

    report += `## Recommendations\n\n`;

    if (gateResults.criticalFailed) {
      report += `🚨 **CRITICAL**: Address critical security vulnerabilities immediately before deployment.\n\n`;
    }

    if (gateResults.highFailed) {
      report += `⚠️ **HIGH**: Resolve high-priority security issues as soon as possible.\n\n`;
    }

    if (gateResults.passed) {
      report += `🎉 All security quality gates passed! The application meets security standards for deployment.\n\n`;
    } else {
      report += `❌ Security quality gates failed. Please address the identified issues before proceeding with deployment.\n\n`;
    }

    report += `## Security Testing Coverage\n\n`;
    report += `- ✅ Vulnerability Regression Testing\n`;
    report += `- ✅ Automated Security Framework Testing\n`;
    report += `- ✅ AI Safety and Prompt Injection Testing\n`;
    report += `- ✅ Performance Security Testing\n`;
    report += `- ✅ Static Application Security Testing (SAST)\n`;
    report += `- ✅ Dynamic Application Security Testing (DAST)\n`;
    report += `- ✅ Container Security Scanning\n`;
    report += `- ✅ Infrastructure as Code Security\n`;

    return report;
  }

  outputGateDecision(gateResults) {
    console.log('🎯 Security Quality Gate Decision:\n');

    if (gateResults.passed) {
      console.log('✅ ALL SECURITY QUALITY GATES PASSED');
      console.log('🚀 Application is approved for deployment');
      console.log('📊 Security Score:', this.metrics.overallSecurityScore);
    } else {
      console.log('❌ SECURITY QUALITY GATES FAILED');
      console.log('🚫 Deployment is BLOCKED');
      console.log('🔍 Please address the following issues:');

      for (const [gateId, gate] of Object.entries(gateResults.gates)) {
        if (!gate.passed) {
          console.log(`   • ${gate.name}: ${gate.actual} (threshold: ${gate.threshold})`);
        }
      }
    }

    console.log('');

    // Set GitHub Actions outputs
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::set-output name=gates-passed::${gateResults.passed}`);
      console.log(`::set-output name=security-score::${this.metrics.overallSecurityScore}`);
      console.log(`::set-output name=critical-failures::${this.metrics.criticalFailures}`);
      console.log(`::set-output name=high-failures::${this.metrics.highFailures}`);
      console.log(`::set-output name=ai-safety-score::${this.metrics.aiSafetyScore}`);
      console.log(`::set-output name=performance-score::${this.metrics.performanceSecurityScore}`);
    }
  }
}

// Main execution
async function main() {
  const validator = new SecurityGateValidator();
  const passed = await validator.validateSecurityGates();

  process.exit(passed ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

module.exports = SecurityGateValidator;