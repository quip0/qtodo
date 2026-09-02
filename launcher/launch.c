// Launcher stub for ~/Applications/Todo.app.
//
// This must be a real compiled binary, not a shell script: macOS TCC attributes
// Desktop-folder access to the executing binary, and a /bin/bash launcher gets
// silently denied (the app just never starts). A binary with its own bundle id
// gets attributed to com.quipo.todo.launcher and prompts properly instead.
//
// Recompile with scripts/make-app.js after changing PROJ.

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define PROJ "/Users/quipo/Desktop/main/projects/todo"

int main(void) {
    const char *home = getenv("HOME");
    char log[1024];
    snprintf(log, sizeof log, "%s/Library/Logs/todo-launch.log",
             home ? home : "/tmp");

    freopen(log, "a", stdout);
    freopen(log, "a", stderr);

    // LaunchServices starts apps with PATH=/usr/bin:/bin:/usr/sbin:/sbin, which
    // has no node — so launching from Finder/Dock/qcommand dies with
    // "env: node: No such file or directory" even though a shell launch works.
    // Homebrew first, matching the Drive, CStudy and Quip IDE launchers.
    setenv("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", 1);

    if (chdir(PROJ) != 0) {
        perror("todo: chdir " PROJ);
        return 1;
    }

    // build.js repairs Electron's signature and install; see scripts/.
    system("node build.js");

    // Deliberately wait on Electron rather than exec'ing into it: this process
    // is the one macOS identifies as Todo.app, and qcommand focuses an already
    // running app by finding that process and then walking to the descendant
    // that owns a window. Exec'ing would erase that identity, so qcommand would
    // never find Todo and would launch a duplicate copy every time.
    int rc = system(PROJ "/node_modules/.bin/electron .");
    if (rc != 0) fprintf(stderr, "todo: electron exited with status %d\n", rc);
    return rc == 0 ? 0 : 1;
}
