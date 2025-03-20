using System;
using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using Grid;
using UnityEngine;

namespace Entities.Enemies
{
    [Serializable]
    public class MassAttackAbility : BaseAbility
    {
        [SerializeField] public LayerMask targetLayer;

        private static List<Vector3Int> _directions = new()
        {
            new Vector3Int(1, 0), // 0° - вправо
            new Vector3Int(1, 1), // 45° - вверх-вправо
            new Vector3Int(0, 1), // 90° - вверх
            new Vector3Int(-1, 1), // 135° - вверх-влево
            new Vector3Int(-1, 0), // 180° - влево
            new Vector3Int(-1, -1), // 225° - вниз-влево
            new Vector3Int(0, -1), // 270° - вниз
            new Vector3Int(1, -1), // 315° - вниз-вправо
        };

        public override async UniTask Execute()
        {
            if (_tryToExecute())
            {
                await _execute();
                _reset(State.Completed);
            }
            else if (State != State.Preparing)
            {
                _prepare();   
            }
        }
        
        public override void Cancel()
        {
            if (State != State.Preparing) return;

            _reset();
        }

        private void _prepare()
        {
            State = State.Preparing;
            
            foreach (var direction in _directions)
            {
                var tileCenter = GridService.GridPositionToTileCenter(Owner.GridPosition + direction);
                _drawDebugPoint(tileCenter, Color.yellow);
            }
        }

        private async UniTask _execute()
        {
            State = State.Execute;
            
            var tasks = new List<UniTask>();

            foreach (var direction in _directions)
            {
                var tileCenter = GridService.GridPositionToTileCenter(Owner.GridPosition + direction);
                var hit = Physics2D.OverlapPoint(new Vector2(tileCenter.x, tileCenter.y), targetLayer);

                if (hit == null) continue;
                
                var entity = hit.GetComponent<BaseEntity>();

                if (entity != null)
                {
                    tasks.Add(entity.Health.TakeDamage(1));
                    _drawDebugPoint(GridService.GridPositionToTileCenter(entity.GridPosition), Color.red);
                }
            }

            await UniTask.WhenAll(tasks);
        }

        private void _reset(State state = State.Pending)
        {
            _castCounter = 0;
            State = state;
        }
    }
}