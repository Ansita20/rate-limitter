from pathlib import Path
from setuptools import setup, find_packages

long_description = (Path(__file__).parent / "README.md").read_text(encoding="utf-8")

setup(
    name="throttle-sdk",
    version="1.0.0",
    description="Python SDK for Throttle, a self-hosted multi-tenant rate limiting API",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/Ansita20/rate-limitter/tree/main/sdk-python",
    author="Ansita Singh",
    license="ISC",
    packages=find_packages(),
    install_requires=["requests>=2.25"],
    python_requires=">=3.7",
    extras_require={"flask": ["flask"]},
    classifiers=[
        "License :: OSI Approved :: ISC License (ISCL)",
        "Programming Language :: Python :: 3",
        "Operating System :: OS Independent",
        "Intended Audience :: Developers",
        "Topic :: Internet :: WWW/HTTP",
    ],
)
