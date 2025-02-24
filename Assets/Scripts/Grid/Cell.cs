using System.Collections.Generic;
using Core;
using Core.Entities;
using JetBrains.Annotations;
using NUnit.Framework;
using UnityEngine;
using Services.Grid;

namespace Grid
{
    /// <summary>
    /// Клетка на игровом поле.
    /// </summary>
    [System.Serializable]
    public class Cell : MonoBehaviour
    {
        [SerializeField] private Vector2Int position;
        [SerializeField] private CellType cellType;

        private static List<Vector2Int> _directions = new()
        {

            new Vector2Int(1, 0), // 0° - вправо
            new Vector2Int(1, 1), // 45° - вверх-вправо
            new Vector2Int(0, 1), // 90° - вверх
            new Vector2Int(-1, 1), // 135° - вверх-влево
            new Vector2Int(-1, 0), // 180° - влево
            new Vector2Int(-1, -1), // 225° - вниз-влево
            new Vector2Int(0, -1), // 270° - вниз
            new Vector2Int(1, -1), // 315° - вниз-вправо
        };
        
        public Vector2Int Position => position;

        public CellType Type
        {
            get => cellType;
            set => cellType = value;
        }
        
        public bool IsAvailableForEntity()
        {
            return Type != CellType.Blocked;
        }

        public List<Cell> GetNeighbors()
        {
            var neighbors = new List<Cell>();

            foreach (var direction in _directions)
            {
                var nextPosition = Position + direction;
                var cell = GridService.Instance.GetCell(nextPosition.x, nextPosition.y);

                if (cell)
                {
                    neighbors.Add(cell);
                }
            }

            return neighbors;
        }

        [CanBeNull]
        public Entity GetEntity()
        {
            return GridService.Instance.GetEntityAt(Position);
        }
    }

    /// <summary>
    /// Тип клетки: пустая, непроходимая, разрушаемая, ловушка и т.д.
    /// </summary>
    public enum CellType
    {
        Empty,
        Blocked,
    }
}