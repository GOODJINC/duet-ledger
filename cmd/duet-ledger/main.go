package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"duet-ledger/internal/app"
	"duet-ledger/internal/webassets"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	command := "serve"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command = args[0]
		args = args[1:]
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	data := flags.String("data-dir", env("DUET_LEDGER_DATA_DIR", "./data"), "persistent data directory")
	addr := flags.String("listen", env("DUET_LEDGER_LISTEN", "127.0.0.1:8080"), "listen address")
	archive := flags.String("archive", "", "backup zip to restore")
	key := flags.String("key-file", "", "original master.key")
	username := flags.String("username", "", "account username")
	disableTOTP := flags.Bool("disable-totp", false, "disable two-factor authentication during local recovery")
	if err := flags.Parse(args); err != nil {
		return err
	}
	switch command {
	case "version":
		fmt.Println(app.Version)
		return nil
	case "restore":
		if *archive == "" || *key == "" {
			return fmt.Errorf("restore requires --archive and --key-file; --data-dir must be empty")
		}
		if err := app.Restore(*archive, *data, *key); err != nil {
			return err
		}
		fmt.Println("Restored into a new data directory. Review sharing before exposing the server.")
		return nil
	case "serve", "reset-password":
	default:
		return fmt.Errorf("supported commands: serve, version, restore, reset-password")
	}
	assets, _ := fs.Sub(webassets.Files, "dist")
	a, err := app.New(app.Config{DataDir: *data, PublicURL: os.Getenv("DUET_LEDGER_PUBLIC_URL"), SecureCookie: os.Getenv("DUET_LEDGER_SECURE_COOKIE") == "true", Assets: assets})
	if err != nil {
		return err
	}
	defer a.Close()
	if command == "reset-password" {
		password, err := io.ReadAll(io.LimitReader(os.Stdin, 1024))
		if err != nil {
			return err
		}
		return a.ResetPassword(*username, strings.TrimRight(string(password), "\r\n"), *disableTOTP)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	backupDone := make(chan struct{})
	go func() { defer close(backupDone); a.RunBackups(ctx) }()
	defer func() { stop(); <-backupDone }()
	server := &http.Server{Addr: *addr, Handler: a.Routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Duet Ledger %s listening on %s", app.Version, *addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
