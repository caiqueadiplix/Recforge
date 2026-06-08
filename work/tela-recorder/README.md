# Tela Recorder

Gravador de tela Windows-first com interface React e backend desktop.

## Rodar agora

Na pasta do projeto:

```powershell
npm run desktop
```

Ou use o atalho:

```powershell
..\..\outputs\Abrir Tela Recorder.cmd
```

## Comandos rapidos

Os atalhos em `outputs` controlam o app por `http://127.0.0.1:17654`:

```text
Abrir Tela Recorder.cmd
Iniciar Gravacao.cmd
Pausar Retomar Gravacao.cmd
Mutar Microfone.cmd
Encerrar Gravacao.cmd
Mostrar Tela Recorder.cmd
```

`Iniciar Gravacao.cmd` tenta mandar comando para o app aberto. Se ele nao estiver aberto, inicia o Electron em modo rapido e grava a primeira fonte disponivel.

## Testar gravacao real

Este comando grava a tela por alguns segundos, para o FFmpeg e valida se saiu um MP4 com conteudo:

```powershell
npm run test:record
```

O arquivo de teste fica em:

```text
test-output\smoke-start-stop.mp4
```

## O que funciona neste MVP

- Interface desktop bonita com Electron.
- FFmpeg portatil instalado via npm (`@ffmpeg-installer/ffmpeg`).
- Captura fluida de tela ou janela via Electron/Chromium `desktopCapturer`.
- Preview real da fonte escolhida.
- Lista microfones reais do Electron/Chromium e grava pelo `deviceId` selecionado.
- Teste de microfone com medidor de nivel dentro do app.
- Overlay pequeno com pausar, mutar microfone e encerrar. Ele usa `setContentProtection(true)` para tentar ficar fora da captura no Windows.
- Salvamento em `.webm`, que e mais leve para gravacao fluida em tempo real.
- Saida padrao em `Videos\Tela Recorder`.
- Aba Editor com importacao de video, preview, corte por inicio/fim e exportacao via FFmpeg.
- Navegacao visual estilo studio premium, com sidebar, biblioteca/editor/configuracoes e tema escuro com acento salmao.
- Configuracao de hotkeys globais dentro da aba Hotkeys.
- Biblioteca real lendo `Videos\Tela Recorder`, com cards, abrir no editor, renomear, excluir e converter para MP4.
- Opcao de converter automaticamente para MP4 ao encerrar a gravacao.

O caminho antigo de FFmpeg `gdigrab` ainda existe no backend como fallback/teste, mas ele e mais pesado e pode capturar o desktop virtual inteiro em computadores com varios monitores.

## Editor

A aba Editor permite abrir um `.webm`, `.mp4`, `.mov` ou `.mkv`, definir inicio/fim e exportar um novo arquivo editado para `Videos\Tela Recorder`.

O corte pode ser ajustado por campos numericos ou pelas barras de range da timeline.

Nesta primeira versao o corte usa `ffmpeg -c copy`, entao e muito rapido e preserva qualidade. Em alguns arquivos, o corte pode alinhar no keyframe mais proximo; uma versao futura pode adicionar renderizacao precisa frame a frame quando necessario.

## Audio do sistema

O Windows desta maquina mostrou apenas:

```text
Microfone (Realtek(R) Audio)
```

Para gravar o som do PC junto, o Windows precisa expor um dispositivo como `Stereo Mix`, `Mixagem Estereo`, `Loopback` ou equivalente. Quando esse dispositivo nao aparece, o app desliga a opcao de audio do sistema automaticamente.

## Tauri

A estrutura Tauri tambem esta no projeto, mas o build nativo precisa do Visual Studio Build Tools com o workload `Desktop development with C++`, porque o Rust/MSVC precisa do `link.exe`.
