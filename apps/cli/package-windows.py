"""Create a Windows prototype bundle from the exact npm release artifact."""
import argparse
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--package", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
if not args.package.is_file():
    parser.error("npm package does not exist")
assets = Path(__file__).parent / "windows"
with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    bundle.write(args.package, args.package.name)
    for name in ["Install-LakesideCode.ps1", "Install-LakesideCodeWSL.ps1", "Install-LakesideCodeWSL.sh", "README.md"]:
        bundle.write(assets / name, name)
print(args.output)
