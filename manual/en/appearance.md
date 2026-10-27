# Shared CSS and fonts

Administrators can set a shared design and font under **Manage → Shared CSS and font**. They apply to all signed-in users, but not to the sign-in screen or manual pages.

Personal brightness, colors, text size and layout are stored separately under **Settings → Display settings for this browser**.

## Start with the CSS sample

1. Select **Manage → Shared CSS and font → Download sample CSS**. You can also view the [source sample](../samples/soft-blue.css).
2. Choose the downloaded `.css` file under **CSS file → Choose file**.
3. The upload applies automatically. Other users’ open screens update within about 15 seconds.
4. In light mode, check that buttons and accents turn blue and card corners change. Dark-mode accent colors keep their existing values.

The main part of the sample is shown below. Replace the color values and save your own file.

```css
body[data-theme="light"] {
  --green: #315f8b;
  --mint: #e5eef6;
  --mint-soft: #f0f5fa;
}

.panel {
  border-radius: 16px;
}
```

| Setting | What it changes |
| --- | --- |
| `--green` | Primary buttons and accents |
| `--mint` | Selected-item backgrounds |
| `--mint-soft` | Subtle accent backgrounds |
| `.panel` → `border-radius` | Card corners |

Personal browser colors may take precedence over shared colors. To try the sample with the default personal design, use **Settings → Display settings for this browser → Reset personal appearance**. This does not remove shared CSS.

## Create your own CSS file

1. Open the sample in a text editor.
2. Change the colors or spacing and save a UTF-8 `.css` file.
3. Upload it under **CSS file** to replace the previous shared CSS.

External resource loading with `url()`, `@import` or `@font-face`, and CSS escape sequences, are not allowed. Use the font uploader below for custom fonts. Check your modified screens after app updates.

## Apply a custom font

1. Prepare a **WOFF2** font you have permission to use, with the characters your users need.
2. Select it under **Manage → Shared CSS and font → Custom font → Choose file**.
3. The app connects the font after upload. Other users’ screens update within about 15 seconds.

TTF and OTF files cannot be uploaded directly. Obtain a WOFF2 file from your font provider. Include digits and currency symbols, and check the provider’s usage and distribution terms.

## Remove a design or recover the interface

Select **Remove** beside **CSS file** or **Custom font** to remove that shared file. **This affects all users. Ledger data is not deleted.**

If a design prevents you from using buttons or menus, open `/admin?safe-theme=1` on your app’s address, for example `https://ledger.example.com/admin?safe-theme=1`. Sign in as an administrator and remove the shared file. This URL temporarily bypasses both shared and personal designs.

The app does not retain earlier files for undo. Keep the original CSS and font files if you want to apply them again.

## Storage and file size

Shared CSS and fonts are stored with the server data and included in operational backups and restores. They remain after container updates when you keep the data volume.

The app does not limit file size. Server storage and reverse-proxy upload limits can still apply. Large font files can take longer to load.

[Settings guide](usage.md) · [Backup and restore](operations.md) · [한국어](../ko/appearance.md)
