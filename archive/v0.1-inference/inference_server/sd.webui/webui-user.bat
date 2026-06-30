@echo off

set PYTHON=
set GIT=
set VENV_DIR=

set SD_DIR=%UserProfile%\Documents\sd
set MODELS_DIR=%UserProfile%\Documents\sd\models

set DIR_ARGS=^
--ckpt-dir "%MODELS_DIR%\Stable-diffusion" ^
--lora-dir "%MODELS_DIR%\Lora" ^
--hypernetwork-dir "%MODELS_DIR%\hypernetworks" ^
--embeddings-dir "%MODELS_DIR%\embeddings" ^
--textual-inversion-templates-dir "%MODELS_DIR%\textual_inversion_templates" ^
--vae-dir "%MODELS_DIR%\VAE" ^
--esrgan-models-path "%MODELS_DIR%\ESRGAN" ^
--realesrgan-models-path "%MODELS_DIR%\RealESRGAN" ^
--codeformer-models-path "%MODELS_DIR%\Codeformer" ^
--gfpgan-dir "%MODELS_DIR%\GFPGAN" ^
--gfpgan-models-path "%MODELS_DIR%\GFPGAN" ^
--bsrgan-models-path "%MODELS_DIR%\BSRGAN" ^
--scunet-models-path "%MODELS_DIR%\ScuNET" ^
--swinir-models-path "%MODELS_DIR%\SwinIR" ^
--ldsr-models-path "%MODELS_DIR%\LDSR" ^
--dat-models-path "%MODELS_DIR%\DAT" ^
--clip-models-path "%MODELS_DIR%\CLIP"

set COMMANDLINE_ARGS=%DIR_ARGS% ^
--theme dark ^
--api ^
--listen ^
--enable-insecure-extension-access ^
--xformers --precision half



call webui.bat
