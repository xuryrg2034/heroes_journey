using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;
using Unity.VisualScripting;
using UnityEngine;

namespace Abilities.EnemyAbilities
{
    [Serializable]
    public class MassAttackAbility : BaseAbility
    {
        private List<Cell> _targetCells;

        public override async UniTask Execute()
        {
            if (_tryToExecute())
            {
                _castCounter = 0;

                await _execute();
            }
            else
            {
                await _prepare();   
            }
        }

        private UniTask _prepare()
        {
            Debug.Log(Owner.IsDestroyed());
            
            if (Owner.IsDestroyed()) return default;
            
            _targetCells = Owner.Cell
                .GetNeighbors()
                // .Where((item) => item.Type != CellType.Blocked)
                .ToList();

            // foreach (var cell in _targetCells)
            // {
            //     cell.Highlite(true);
            // }

            return default;
        }

        private async UniTask _execute()
        {
            var entityList = _targetCells.Select(cell => cell.GetEntity()).Where(entity => entity).ToList();

            var task = new List<UniTask>();
            
            foreach (var entity in entityList)
            {
                var tween = entity.Health.TakeDamage(1);
            
                task.Add(tween);
            }

            foreach (var cell in _targetCells)
            {
                cell.Highlite(false);
            }

            await UniTask.WhenAll(task);
        }
    }
}