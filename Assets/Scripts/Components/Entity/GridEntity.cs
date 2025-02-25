using System;
using Grid;
using UnityEngine;

namespace Components.Entity
{
    public class GridEntity : MonoBehaviour
    {
        [SerializeField] private Cell cell;

        public Cell Cell => cell;

        public Vector2Int Position => cell.Position;

        public void Init(Cell targetCell)
        {
            transform.position = targetCell.transform.position;
            SetCell(targetCell);
        }

        public void SetCell(Cell value)
        {
            cell = value;
        }
    }
}