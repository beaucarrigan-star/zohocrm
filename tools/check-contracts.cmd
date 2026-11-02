@echo off
rem Runs the contract pipeline's golden tests on this PC (they use real contract text kept out of GitHub).
rem Run this before you push a contract-pipeline change.
cd /d "C:\Users\Beau\OneDrive - JusticePoint\Zoho\contract-pipeline"
python -m pytest tests -q -p no:cacheprovider
echo.
if errorlevel 1 (echo TESTS FAILED - do not push.) else (echo All golden tests passed - safe to push.)
pause
