@echo off
rem Fabrique dist\SuiviClasse.exe (programme portable, a copier sur la cle USB).
rem Prerequis : Python 3.10 a 3.13 installe, puis :  py -m pip install -r requirements-dev.txt
py -m PyInstaller --noconfirm --onefile --windowed --name SuiviClasse suiviclasse\__main__.py
echo.
echo Termine : dist\SuiviClasse.exe
pause
