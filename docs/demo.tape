# Run from the repository root with bun run demo.
# Real configurator, built-in sample data, disposable settings (never your own).
Output docs/demo.gif
Set Shell "bash"
Set Width 1100
Set Height 660
Set FontSize 19
Set Theme "Catppuccin Mocha"
Set TypingSpeed 70ms
Set Framerate 15
Hide
Type@1ms `export XDG_CONFIG_HOME=$(mktemp -d /tmp/cxstatusline-demo.XXXXXX); mkdir -p "$XDG_CONFIG_HOME/cxstatusline"; cp docs/demo-settings.json "$XDG_CONFIG_HOME/cxstatusline/settings.json"; export PS1='$ '; alias cxstatusline='node dist/cxstatusline.js'; clear`
Enter
Sleep 500ms
Show
Type "cxstatusline"
Enter
Sleep 2s
# Lines -> first row -> add a session-duration widget.
Enter
Sleep 500ms
Enter
Sleep 1s
Type "a"
Sleep 500ms
Type "session"
Sleep 1s
Enter
Sleep 1s
Ctrl+S
Sleep 1s
# Saving returns to the main menu. Colors -> first row.
Down
Enter
Sleep 500ms
Enter
Sleep 1s
Right
Sleep 700ms
Right
Sleep 700ms
Type "b"
Sleep 1s
Ctrl+S
Sleep 2s
