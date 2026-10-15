# v4 page color audit

The shared dark and light palettes are defined in `design-system.js`. A source scan of `*-page.js` found hexadecimal colors in 18 page modules. Many are fallbacks inside `var(...)`; those follow the active palette when it is present. The scan also found direct status colors and chart colors.

The legacy Agents directory's status colors now use `--green`, `--amber`, and `--red`; that page is deprecated and absent from navigation. Ticket milestone badges and the launch button also use shared accent tokens.

The remaining direct colors occur mainly in `tmux-terminal-page.js`, `code-page.js`, `pr-reviews-page.js`, `replay-page.js`, and visualizations. Review each against both palettes before the public generic release; chart series need deliberate contrast choices and should not be changed by blind string replacement.
