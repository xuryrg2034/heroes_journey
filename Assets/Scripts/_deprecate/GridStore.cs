using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;


public class GridStore
{
    private _Cell[,] _cellsGrid = new _Cell[3, 3];
    public _Gem[,] gemsGrid;
    public GameObject grid = new();
    private _Cell _spawnerPrefab;
    public List<CellPosition> SelectedCell { get; private set; } = new List<CellPosition>();
    public int AvailableTypeForSelection { get; private set; } = 0;

    public GridStore(_Cell spawnerPrefab)
    {
        _spawnerPrefab = spawnerPrefab;
    }

    public void CreateCellGrid()
    {
        var transform = grid.transform;
        var position = transform.position;
        var width = _cellsGrid.GetLength(0);
        var height = _cellsGrid.GetLength(1);
        gemsGrid = new _Gem[width, height];

        for (int i = 0; i < width; i++)
        {
            for (int j = 0; j < height; j++)
            {
                var cellPosition = position + Vector3.down * i + Vector3.right * j;
                _cellsGrid[i, j] = Object.Instantiate(_spawnerPrefab, cellPosition, Quaternion.identity, transform);
            }
        }
    }

    public void FillGemsGrid()
    {
        var gemsGridWidth = _cellsGrid.GetLength(0);
        var gemsGridHeight = _cellsGrid.GetLength(1);

        for (int i = 0; i < gemsGridWidth; i++)
        {
            for (int j = 0; j < gemsGridHeight; j++)
            {
                var cell = _cellsGrid[i, j];
                var gem = gemsGrid[i, j];

                if (gem == null)
                {
                    gemsGrid[i, j] = cell.Spawn(cell.transform, i, j, grid.transform);
                }
            }
        }
    }

    public void SelectCell(CellPosition position)
    {
        SelectedCell.Add(position);
    }

    public void RemoveRangeFrom(int index)
    {
        var deleteIndexPosition = index + 1;

        SelectedCell.RemoveRange(deleteIndexPosition, SelectedCell.Count - deleteIndexPosition);
    }

    public void ClearSelection()
    {
        SelectedCell.Clear();
        AvailableTypeForSelection = 0;
    }

    public void ChangeAvailableType(int availableType)
    {
        AvailableTypeForSelection = availableType;
    }
}
