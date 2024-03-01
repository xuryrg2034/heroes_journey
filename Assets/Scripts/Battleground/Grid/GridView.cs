using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

public class GridView : MonoBehaviour
{
    [SerializeField] private List<CellType> _cellDictionary;
    private Cell[,] cellArray;

    public void InitializeBoard(int[,] template)
    {
        int row = template.GetLength(0);
        int column = template.GetLength(1);

        for (int i = 0; i < row; i++)
        {
            for (int j = 0; j < column; j++)
            {
                CellType cell = _cellDictionary.Find((item) => item.type == template[i, j]);
                var cellGameObject = Instantiate(cell.prefab, transform);

                cellGameObject.Initialze(j, i);
            }
        }
    }

    public void SpawnGems()
    {
    }
}
